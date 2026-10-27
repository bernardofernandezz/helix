import type { Page } from '@playwright/test'
import { test, expect } from './helpers/helix-app'
import { splitActiveTerminalPane, waitForPaneCount } from './helpers/terminal'
import { getActiveWorktreeId, getActiveTabId, getWorktreeTabs } from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import {
  setPaneTitleFromTerminalMenu,
  openTerminalContextMenu
} from './helpers/terminal-pane-title-actions'
import {
  readVisibleXtermContainerBox,
  expectTerminalToReserveTitleSpace
} from './helpers/terminal-pane-geometry'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

async function openPaneTitleContextMenu(page: Page, title: string): Promise<void> {
  const modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[] = (await page.evaluate(() =>
    navigator.userAgent.includes('Windows')
  ))
    ? ['Control']
    : []
  const isMac = await page.evaluate(() => navigator.userAgent.includes('Mac'))
  const titleBar = page.locator('.pane-title-bar', { hasText: title }).first()
  await expect(titleBar).toBeVisible()
  await titleBar.click({
    button: isMac ? 'left' : 'right',
    position: { x: 20, y: 10 },
    modifiers: isMac ? ['Control'] : modifiers
  })
  await expect(page.getByText('Set Title…', { exact: true })).toBeVisible()
}

async function getTabCustomTitle(
  page: Page,
  worktreeId: string,
  tabId: string
): Promise<string | null> {
  return page.evaluate(
    ({ targetWorktreeId, targetTabId }) => {
      const state = window.__store!.getState()
      const tab = (state.tabsByWorktree[targetWorktreeId] ?? []).find(
        (entry) => entry.id === targetTabId
      )
      return tab?.customTitle ?? null
    },
    { targetWorktreeId: worktreeId, targetTabId: tabId }
  )
}

async function expectTabCustomTitle(
  page: Page,
  worktreeId: string,
  tabId: string,
  expected: string | null
): Promise<void> {
  await expect
    .poll(() => getTabCustomTitle(page, worktreeId, tabId), { timeout: 3_000 })
    .toBe(expected)
}

async function expectSavedLayoutNotToContainTitle(
  page: Page,
  tabId: string,
  title: string
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ targetTabId, title }) => {
            const layout = window.__store!.getState().terminalLayoutsByTabId[targetTabId]
            return Object.values(layout?.titlesByLeafId ?? {}).includes(title)
          },
          { targetTabId: tabId, title }
        ),
      { timeout: 3_000 }
    )
    .toBe(false)
}

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('first Set Title from terminal context menu stays open for typing', async ({
    helixPage
  }) => {
    const title = `First menu title ${Date.now()}`

    await openTerminalContextMenu(helixPage)
    await helixPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = helixPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await helixPage.waitForTimeout(250)
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()

    await titleInput.fill(title)
    await titleInput.press('Enter')

    await expect(titleInput).toHaveCount(0)
    await expect(helixPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title editor renders in Helix overlay while terminal reserves title space', async ({
    helixPage
  }) => {
    const title = `Reserved overlay title ${Date.now()}`
    const terminalBoxBefore = await readVisibleXtermContainerBox(helixPage)

    await openTerminalContextMenu(helixPage)
    await helixPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = helixPage.locator('.pane-title-overlay-layer .pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await expect(helixPage.getByText('Set Title…', { exact: true })).toBeHidden()
    await expect(helixPage.locator('.pane .pane-title-input')).toHaveCount(0)
    await expect(helixPage.locator('.pane[data-has-title]')).toHaveCount(1)
    await expect
      .poll(() =>
        helixPage
          .locator('.pane-title-bar')
          .first()
          .evaluate((titleBar) => getComputedStyle(titleBar).backgroundColor)
      )
      .not.toBe('rgba(0, 0, 0, 0)')
    const terminalBoxEditing = await readVisibleXtermContainerBox(helixPage)
    expectTerminalToReserveTitleSpace(terminalBoxEditing, terminalBoxBefore)

    await titleInput.fill(title)
    await titleInput.press('Enter')
    await expect(helixPage.locator('.pane-title-text', { hasText: title })).toBeVisible()
    await expect(helixPage.locator('.pane[data-has-title]')).toHaveCount(1)
    expectTerminalToReserveTitleSpace(
      await readVisibleXtermContainerBox(helixPage),
      terminalBoxBefore
    )
  })

  test('Set Title context menu opens from the title overlay strip', async ({ helixPage }) => {
    const title = `Overlay menu title ${Date.now()}`
    const updatedTitle = `Overlay menu updated ${Date.now()}`

    await setPaneTitleFromTerminalMenu(helixPage, title)
    await openPaneTitleContextMenu(helixPage, title)
    await helixPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = helixPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await expect(titleInput).toHaveValue(title)
    await titleInput.fill(updatedTitle)
    await titleInput.press('Enter')

    await expect(helixPage.locator('.pane-title-text', { hasText: updatedTitle })).toHaveCount(1)
    await expect(helixPage.locator('.pane-title-text', { hasText: title })).toHaveCount(0)
  })

  test('Set Title commits when tabbing away from the title input', async ({ helixPage }) => {
    const title = `Tab commit title ${Date.now()}`

    await openTerminalContextMenu(helixPage)
    await helixPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = helixPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await titleInput.fill(title)
    await titleInput.press('Tab')

    await expect(titleInput).toHaveCount(0)
    await expect(helixPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title overlay hides with its inactive terminal tab', async ({ helixPage }) => {
    const title = `Hidden tab title ${Date.now()}`
    const worktreeId = (await getActiveWorktreeId(helixPage))!

    await setPaneTitleFromTerminalMenu(helixPage, title)
    await expect(helixPage.locator('.pane-title-text', { hasText: title })).toBeVisible()

    await pressShortcut(helixPage, 't')
    await expect
      .poll(async () => (await getWorktreeTabs(helixPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)
    await expect(helixPage.locator('.pane-title-text', { hasText: title })).toBeHidden()

    await pressShortcut(helixPage, 'BracketLeft', { shift: true })
    await expect(helixPage.locator('.pane-title-text', { hasText: title })).toBeVisible()
  })

  test('Set Title still commits by blur after focus settles', async ({ helixPage }) => {
    const title = `Blur commit title ${Date.now()}`

    await openTerminalContextMenu(helixPage)
    await helixPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = helixPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await helixPage.waitForTimeout(100)
    await titleInput.fill(title)
    await helixPage
      .locator('.xterm:visible')
      .first()
      .click({ position: { x: 40, y: 60 } })

    await expect(titleInput).toHaveCount(0)
    await expect(helixPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title stays pane-local during agent title churn', async ({ helixPage }) => {
    const worktreeId = (await getActiveWorktreeId(helixPage))!
    const tabId = (await getActiveTabId(helixPage))!
    const paneTitle = `Codex pane ${Date.now()}`
    const removeButtonTitle = `Remove button label ${Date.now()}`
    const splitTitle = `Split label ${Date.now()}`
    const runtimeTitle = '⠋ Codex working'

    await setPaneTitleFromTerminalMenu(helixPage, paneTitle)
    await expect(helixPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()
    await expectTabCustomTitle(helixPage, worktreeId, tabId, null)

    await helixPage.getByRole('button', { name: `Edit pane title: ${paneTitle}` }).focus()
    await helixPage.keyboard.press('Enter')
    const paneTitleInput = helixPage.getByRole('textbox', { name: 'Pane title' })
    await expect(paneTitleInput).toBeVisible()
    await expect(paneTitleInput).toBeFocused()
    await helixPage.keyboard.press('Escape')
    await expect(paneTitleInput).toHaveCount(0)
    await expect(helixPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()

    await helixPage.evaluate(
      ({ targetTabId, title }) => {
        window.__store!.getState().updateTabTitle(targetTabId, title)
      },
      { targetTabId: tabId, title: runtimeTitle }
    )

    // OSC titles may churn continuously; pane-local Set Title must remain visible while tab runtime title follows the active PTY.
    await expect(helixPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()
    await expect(
      helixPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    ).toHaveAttribute('data-tab-title', runtimeTitle)
    await expectTabCustomTitle(helixPage, worktreeId, tabId, null)

    await setPaneTitleFromTerminalMenu(helixPage, '')
    await expect(helixPage.locator('.pane-title-text', { hasText: paneTitle })).toBeHidden()
    await expectSavedLayoutNotToContainTitle(helixPage, tabId, paneTitle)

    await setPaneTitleFromTerminalMenu(helixPage, removeButtonTitle)
    await setPaneTitleFromTerminalMenu(helixPage, '')
    await expect(helixPage.locator('.pane-title-text', { hasText: removeButtonTitle })).toBeHidden()
    await expectSavedLayoutNotToContainTitle(helixPage, tabId, removeButtonTitle)

    await setPaneTitleFromTerminalMenu(helixPage, splitTitle)
    await expectTabCustomTitle(helixPage, worktreeId, tabId, null)

    await splitActiveTerminalPane(helixPage, 'vertical')
    await waitForPaneCount(helixPage, 2)
    await expect(helixPage.locator('.pane-title-text', { hasText: splitTitle })).toBeVisible()

    await helixPage.evaluate(
      ({ targetTabId, title }) => {
        window.__store!.getState().updateTabTitle(targetTabId, title)
      },
      { targetTabId: tabId, title: runtimeTitle }
    )
    await expect(
      helixPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    ).toHaveAttribute('data-tab-title', runtimeTitle)
  })
})
