import type { Page } from '@playwright/test'
import { expect, test } from './helpers/helix-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })
test.skip(process.platform !== 'win32', 'A real Windows ConPTY is required')

async function getKittyKeyboardFlags(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const pane = tabId ? window.__paneManagers?.get(tabId)?.getActivePane?.() : null
    const terminal = pane?.terminal as
      | {
          core?: { coreService?: { kittyKeyboard?: { flags?: number } } }
          _core?: { coreService?: { kittyKeyboard?: { flags?: number } } }
        }
      | undefined
    return (
      terminal?.core?.coreService?.kittyKeyboard?.flags ??
      terminal?._core?.coreService?.kittyKeyboard?.flags ??
      null
    )
  })
}

test('resets standard keyboard bytes after a protocol-mode agent exits on ConPTY', async ({
  electronApp,
  helixPage
}) => {
  await installTerminalPtyWriteSpy(electronApp)
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  await ensureTerminalVisible(helixPage)
  // Grok is the supported native ConPTY exception to Kitty protocol withholding.
  await configureGoldenStubAgent(helixPage, {
    agent: 'grok',
    agentArgs: '--keyboard-protocol --grok'
  })
  await launchGoldenStubAgentFromNewTab(helixPage, /^Grok(?:\s|$)/i)

  const ptyId = await waitForActivePanePtyId(helixPage)
  await expect.poll(() => getKittyKeyboardFlags(helixPage), { timeout: 10_000 }).toBe(1)

  await clearTerminalPtyWriteLog(electronApp)
  // Kitty flag 1 preserves plain Enter; modified Enter proves CSI-u input.
  await helixPage.keyboard.press('Shift+Enter')
  await helixPage.keyboard.type('exit')
  await helixPage.keyboard.press('Enter')
  await waitForTerminalOutput(helixPage, GOLDEN_STUB_EXIT_MARKER, 15_000)
  const protocolWrites = (await readTerminalPtyWriteEntries(electronApp))
    .filter((entry) => entry.id === ptyId)
    .map((entry) => entry.data)
    .join('')
  expect(protocolWrites).toContain('\x1b[13;2u')
  expect(protocolWrites).toContain('\r')
  await expect.poll(() => getKittyKeyboardFlags(helixPage), { timeout: 10_000 }).toBe(0)

  await clearTerminalPtyWriteLog(electronApp)
  await focusActiveTerminalInput(helixPage)
  await helixPage.keyboard.type("Write-Output ('CONPTY_KEYBOARD_' + '")
  await helixPage.evaluate((text) => window.api.ui.writeClipboardText(text), 'REET_')
  await helixPage.keyboard.press('Control+V')
  await helixPage.keyboard.press('ArrowLeft')
  await helixPage.keyboard.press('ArrowLeft')
  await helixPage.keyboard.press('ArrowLeft')
  await helixPage.keyboard.type('S')
  await helixPage.keyboard.press('ArrowRight')
  await helixPage.keyboard.press('ArrowRight')
  await helixPage.keyboard.press('ArrowRight')
  await helixPage.keyboard.type('EXECUTEX')
  await helixPage.keyboard.press('Backspace')
  await helixPage.keyboard.type("D')")
  await helixPage.keyboard.press('Enter')
  await waitForTerminalOutput(helixPage, 'CONPTY_KEYBOARD_RESET_EXECUTED', 15_000)

  const shellWrites = (await readTerminalPtyWriteEntries(electronApp))
    .filter((entry) => entry.id === ptyId)
    .map((entry) => entry.data)
  const joinedShellWrites = shellWrites.join('')
  expect(joinedShellWrites).toContain('REET_')
  expect(shellWrites.filter((data) => data === '\x1b[D')).toHaveLength(3)
  expect(shellWrites.filter((data) => data === '\x1b[C')).toHaveLength(3)
  expect(shellWrites).toContain('\x7f')
  expect(shellWrites).toContain('\r')
  expect(joinedShellWrites).not.toMatch(new RegExp(`${String.fromCharCode(27)}\\[\\d+(?:;\\d+)*u`))
})
