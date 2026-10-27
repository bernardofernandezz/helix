import { expect, test } from './helpers/helix-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { focusActiveTerminalInput, getTerminalContent } from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('launches an agent TUI with a live multiline composer', async ({ helixPage }) => {
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  await ensureTerminalVisible(helixPage)
  await configureGoldenStubAgent(helixPage)
  await launchGoldenStubAgentFromNewTab(helixPage)

  const activeTab = helixPage.locator('[data-testid="sortable-tab"][data-active="true"]')
  await expect(activeTab).toHaveAttribute('data-tab-title', /Codex|Golden Stub Agent/i)

  await focusActiveTerminalInput(helixPage)
  await helixPage.keyboard.type('hello from e2e')
  await helixPage.keyboard.press('Shift+Enter')
  await helixPage.keyboard.type('second line')

  await expect
    .poll(() => getTerminalContent(helixPage), { timeout: 10_000 })
    .toContain('> hello from e2e\r\n  second line')
  expect(await getTerminalContent(helixPage)).not.toContain('GOLDEN_STUB_AGENT_SUBMITTED')
})
