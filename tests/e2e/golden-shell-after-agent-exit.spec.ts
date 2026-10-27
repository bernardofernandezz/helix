import { expect, test } from './helpers/helix-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForRestoredTerminalInputReady } from './helpers/restored-terminal-input-readiness'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

// Split the marker so terminal input echo cannot impersonate successful shell execution.
function buildSplitMarkerEcho(prefix: string, suffix: string): { command: string; marker: string } {
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${prefix}' + '${suffix}')`
      : `echo "${prefix}""${suffix}"`
  return { command, marker: `${prefix}${suffix}` }
}

test('opens a clean live shell after an agent exits', async ({ helixPage }) => {
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  await ensureTerminalVisible(helixPage)
  await configureGoldenStubAgent(helixPage)
  await launchGoldenStubAgentFromNewTab(helixPage)

  await helixPage.keyboard.type('exit')
  await helixPage.keyboard.press('Enter')
  await waitForTerminalOutput(helixPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await helixPage.locator('[data-testid="sortable-tab"]').count()
  await helixPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await helixPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(helixPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  const shellPtyId = await waitForActivePanePtyId(helixPage)
  // A bound pane can precede transport readiness; wait or marker keystrokes may be dropped.
  expect(await waitForRestoredTerminalInputReady(helixPage, shellPtyId)).toBe(true)

  const afterAgent = buildSplitMarkerEcho('after-', 'agent')
  await focusActiveTerminalInput(helixPage)
  await helixPage.keyboard.type(afterAgent.command)
  await helixPage.keyboard.press('Enter')
  await waitForTerminalOutput(helixPage, afterAgent.marker, 15_000)

  const afterShiftEnter = buildSplitMarkerEcho('after-shift-', 'enter')
  await helixPage.keyboard.press('Shift+Enter')
  await helixPage.keyboard.type(afterShiftEnter.command)
  await helixPage.keyboard.press('Enter')
  await waitForTerminalOutput(helixPage, afterShiftEnter.marker, 15_000)
  await expect(helixPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
