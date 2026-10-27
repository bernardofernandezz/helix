import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from './helpers/helix-app'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

import {
  readPanelNavigationObserver,
  startPanelNavigationObserver
} from './helpers/plugin-panel-navigation-observer'

const FIXTURE_PATH = path.join(
  process.cwd(),
  'tests/e2e/fixtures/terminal-link-mouse-owner-fixture.cjs'
)
const LINK = 'https://example.com/sta-3888'
const OSC_LINK_TEXT = 'STA_3888_OSC_LINK'

type LinkTarget = { x: number; y: number; mouseTrackingMode: string }
type LinkMode = 'http' | 'osc'

async function startMouseAwareLinkFixture(
  helixPage: Page,
  testInfo: TestInfo,
  linkMode: LinkMode = 'http'
): Promise<{ mouseLogPath: string; ptyId: string; target: LinkTarget }> {
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  await ensureTerminalVisible(helixPage)
  await waitForActiveTerminalManager(helixPage)
  await waitForPaneCount(helixPage, 1)

  const ptyId = await waitForActivePanePtyId(helixPage)
  const mouseLogPath = testInfo.outputPath('child-mouse-reports.log')
  await execInTerminal(
    helixPage,
    ptyId,
    `node ${JSON.stringify(FIXTURE_PATH)} ${JSON.stringify(mouseLogPath)} ${linkMode}`
  )
  const renderedLinkText = linkMode === 'osc' ? OSC_LINK_TEXT : LINK
  await waitForTerminalOutput(helixPage, 'LINK_MOUSE_READY')

  const target = await helixPage.evaluate((linkText) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId = worktreeId ? state?.activeTabIdByWorktree?.[worktreeId] : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null
    if (!pane || !screen) {
      throw new Error('Active terminal screen unavailable')
    }

    const buffer = pane.terminal.buffer.active
    for (let viewportRow = 0; viewportRow < pane.terminal.rows; viewportRow += 1) {
      const text = buffer.getLine(buffer.viewportY + viewportRow)?.translateToString(false)
      const column = text?.indexOf(linkText) ?? -1
      if (column < 0) {
        continue
      }
      const rect = screen.getBoundingClientRect()
      const cell = pane.terminal.dimensions?.css.cell
      if (!cell?.width || !cell.height) {
        throw new Error('Active terminal cell dimensions unavailable')
      }
      return {
        x: rect.left + (column + linkText.length / 2) * cell.width,
        y: rect.top + (viewportRow + 0.5) * cell.height,
        mouseTrackingMode: pane.terminal.modes.mouseTrackingMode
      }
    }
    throw new Error('Rendered fixture link unavailable')
  }, renderedLinkText)

  expect(target.mouseTrackingMode).not.toBe('none')
  return { mouseLogPath, ptyId, target }
}

function childMouseReportCount(mouseLogPath: string): number {
  if (!existsSync(mouseLogPath)) {
    return 0
  }
  return readFileSync(mouseLogPath, 'utf8').trim().split(/\s+/).filter(Boolean).length
}

async function expectChildMouseReports(mouseLogPath: string): Promise<void> {
  await expect
    .poll(() => childMouseReportCount(mouseLogPath), { timeout: 5_000 })
    .toBeGreaterThan(0)
}

async function expectHelixOwnedMouseOutcome(
  mouseLogPath: string,
  reportsBeforeClick = 0
): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
  expect(childMouseReportCount(mouseLogPath)).toBe(reportsBeforeClick)
}

async function openLegacyDisabledLinkSettings(helixPage: Page): Promise<void> {
  await helixPage.evaluate(() => {
    void window.__store?.getState().updateSettings({ terminalLinkActionPopoverEnabled: false })
  })
  await expect
    .poll(() =>
      helixPage.evaluate(
        () => window.__store?.getState().settings?.terminalLinkActionPopoverEnabled
      )
    )
    .toBe(false)
  await helixPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.openSettingsPage()
    state?.openSettingsTarget({ pane: 'browser', repoId: null })
  })
}

test.describe('terminal link click ownership', () => {
  test('selecting Actions reenables a legacy-disabled popover and survives renderer reload', async ({
    helixPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(helixPage, testInfo)
    await openLegacyDisabledLinkSettings(helixPage)

    const choices = helixPage.getByRole('radiogroup', { name: 'Plain click URL behavior' })
    await expect(choices.getByRole('radio', { name: 'Leave to terminal' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await choices.getByRole('radio', { name: 'Actions', exact: true }).click()
    await expect(choices.getByRole('radio', { name: 'Actions', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    await helixPage.reload()
    await waitForSessionReady(helixPage)
    await helixPage.evaluate(() => {
      const state = window.__store?.getState()
      state?.openSettingsPage()
      state?.openSettingsTarget({ pane: 'browser', repoId: null })
    })
    await expect(choices.getByRole('radio', { name: 'Actions', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await helixPage.screenshot({ path: testInfo.outputPath('actions-selected-after.png') })
    await helixPage.evaluate(() => window.__store?.getState().closeSettingsPage())
    await waitForActiveTerminalManager(helixPage)
    await helixPage.mouse.click(target.x, target.y)
    await expect(helixPage.locator('[data-terminal-link-action-popover]')).toBeVisible()
    await expect(helixPage.locator('[data-terminal-link-destination]')).toHaveText(LINK)
    await expectHelixOwnedMouseOutcome(mouseLogPath)
    await helixPage.screenshot({ path: testInfo.outputPath('actions-after.png') })
    await sendToTerminal(helixPage, ptyId, 'q')
  })

  test('explicit Open URL and Leave to terminal choices preserve direct-open modifiers', async ({
    helixPage,
    electronApp
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(helixPage, testInfo)
    await startPanelNavigationObserver(electronApp, helixPage.url())
    await openLegacyDisabledLinkSettings(helixPage)
    const choices = helixPage.getByRole('radiogroup', { name: 'Plain click URL behavior' })
    await choices.getByRole('radio', { name: 'Open URL', exact: true }).click()
    await expect(choices.getByRole('radio', { name: 'Open URL', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await helixPage.evaluate(() => window.__store?.getState().closeSettingsPage())
    await helixPage.mouse.click(target.x, target.y)
    await expect
      .poll(async () => (await readPanelNavigationObserver(electronApp)).externalUrls)
      .toEqual([LINK])
    await expectHelixOwnedMouseOutcome(mouseLogPath)

    await helixPage.evaluate(() => {
      const state = window.__store?.getState()
      state?.openSettingsPage()
      state?.openSettingsTarget({ pane: 'browser', repoId: null })
    })
    await choices.getByRole('radio', { name: 'Leave to terminal', exact: true }).click()
    await expect(
      choices.getByRole('radio', { name: 'Leave to terminal', exact: true })
    ).toHaveAttribute('aria-checked', 'true')
    await helixPage.evaluate(() => window.__store?.getState().closeSettingsPage())
    await helixPage.mouse.click(target.x, target.y)
    await expectChildMouseReports(mouseLogPath)
    expect((await readPanelNavigationObserver(electronApp)).externalUrls).toEqual([LINK])

    const reportsBeforeModifiedClick = childMouseReportCount(mouseLogPath)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await helixPage.keyboard.down(modifier)
    await helixPage.mouse.click(target.x, target.y)
    await helixPage.keyboard.up(modifier)
    await expect
      .poll(async () => (await readPanelNavigationObserver(electronApp)).externalUrls)
      .toEqual([LINK, LINK])
    await expectHelixOwnedMouseOutcome(mouseLogPath, reportsBeforeModifiedClick)
    await expect(helixPage.locator('[data-terminal-link-action-popover]')).toHaveCount(0)
    await sendToTerminal(helixPage, ptyId, 'q')
  })

  test('an Helix-owned plain link click emits no child PTY mouse frames', async ({
    helixPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(helixPage, testInfo)
    await helixPage.mouse.click(target.x, target.y)

    await expect(helixPage.locator('[data-terminal-link-action-popover]')).toBeVisible()
    await expect(helixPage.locator('[data-terminal-link-destination]')).toHaveText(LINK)

    await expectHelixOwnedMouseOutcome(mouseLogPath)

    await sendToTerminal(helixPage, ptyId, 'q')
  })

  test('an Helix-owned OSC link click emits no child PTY mouse frames', async ({
    helixPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(
      helixPage,
      testInfo,
      'osc'
    )
    await helixPage.mouse.move(target.x, target.y)
    await expect(helixPage.locator('.xterm-hover')).toHaveCount(1)
    await helixPage.mouse.click(target.x, target.y)

    await expect(helixPage.locator('[data-terminal-link-action-popover]')).toBeVisible()
    await expect(helixPage.locator('[data-terminal-link-destination]')).toHaveText(LINK)
    await expectHelixOwnedMouseOutcome(mouseLogPath)

    await sendToTerminal(helixPage, ptyId, 'q')
  })

  test('a plain click stays child-owned when link actions are disabled', async ({
    helixPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(helixPage, testInfo)
    await helixPage.evaluate(async () => {
      await window.__store?.getState().updateSettings({ terminalLinkActionPopoverEnabled: false })
    })

    await helixPage.mouse.click(target.x, target.y)

    await expect(helixPage.locator('[data-terminal-link-action-popover]')).toHaveCount(0)
    await expectChildMouseReports(mouseLogPath)
    await sendToTerminal(helixPage, ptyId, 'q')
  })

  test('a drag across a link stays child-owned', async ({ helixPage }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(helixPage, testInfo)

    await helixPage.mouse.move(target.x, target.y)
    await helixPage.mouse.down()
    await helixPage.mouse.move(target.x + 12, target.y + 12, { steps: 3 })
    await helixPage.mouse.up()

    await expect(helixPage.locator('[data-terminal-link-action-popover]')).toHaveCount(0)
    await expectChildMouseReports(mouseLogPath)
    await sendToTerminal(helixPage, ptyId, 'q')
  })
})
