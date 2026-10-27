// keyboard and X close must both confirm for the same live sleep 300 child, preserving the tab until approval.
import { test, expect } from './helpers/helix-app'
import type { Page } from '@playwright/test'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveTabId,
  ensureTerminalVisible
} from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from './helpers/terminal'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

function countRenderedTabs(page: Page): Promise<number> {
  return page.locator(SORTABLE_TAB).count()
}

function closeDialogTitle(page: Page) {
  return page.getByText(/Stop running command\?|Stop this agent\?/)
}

test.describe.configure({ mode: 'serial' })

test('the tab X button applies the same running-process confirmation as Cmd+W', async ({
  helixPage
}) => {
  test.setTimeout(120_000)
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  await ensureTerminalVisible(helixPage)
  const hasPaneManager = await waitForActiveTerminalManager(helixPage, 30_000)
    .then(() => true)
    .catch(() => false)
  test.skip(!hasPaneManager, 'Electron automation never mounted the live TerminalPane manager.')
  await waitForPaneCount(helixPage, 1, 30_000)

  const ptyId = await waitForActivePanePtyId(helixPage)
  await execInTerminal(helixPage, ptyId, 'echo repro-10142-ready')
  await waitForTerminalOutput(helixPage, 'repro-10142-ready', 20_000)
  await execInTerminal(helixPage, ptyId, 'sleep 300')
  // Wait for sleep as foreground process; macOS login makes hasChildProcesses true before the command starts.
  await expect
    .poll(
      async () =>
        (await helixPage.evaluate((id) => window.api.pty.inspectProcess(id), ptyId))
          .foregroundProcess,
      { timeout: 20_000, message: 'sleep 300 never became the foreground process' }
    )
    .toBe('sleep')

  const busyTabId = (await getActiveTabId(helixPage))!
  const busyTab = helixPage.locator(`${SORTABLE_TAB}[data-tab-id="${busyTabId}"]`).first()

  await focusActiveTerminalInput(helixPage)
  await helixPage.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')
  await expect(closeDialogTitle(helixPage)).toBeVisible({ timeout: 15_000 })
  await helixPage.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(closeDialogTitle(helixPage)).toBeHidden()
  await expect(busyTab).toBeVisible()
  const tabsBefore = await countRenderedTabs(helixPage)

  await busyTab.hover()
  await busyTab.getByRole('button', { name: /^Close tab /i }).click()
  await helixPage.waitForTimeout(1_500)

  expect(
    {
      confirmDialogVisible: await closeDialogTitle(helixPage).isVisible(),
      tabStillPresent: (await countRenderedTabs(helixPage)) === tabsBefore
    },
    'X-button close must apply the same running-process confirmation as Cmd+W'
  ).toEqual({ confirmDialogVisible: true, tabStillPresent: true })
})
