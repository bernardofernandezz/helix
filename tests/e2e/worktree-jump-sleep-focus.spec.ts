import { test, expect } from './helpers/helix-app'
import {
  ensureTerminalVisible,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

test('Cmd+J focuses the terminal after waking a sleeping workspace', async ({
  helixPage
}, testInfo) => {
  await waitForSessionReady(helixPage)
  const source = await waitForActiveWorktree(helixPage)
  const target = (await getAllWorktreeIds(helixPage)).find((id) => id !== source)
  if (!target) {
    throw new Error('Expected a second seeded workspace')
  }
  await switchToWorktree(helixPage, target)
  await ensureTerminalVisible(helixPage)
  await waitForActiveTerminalManager(helixPage)
  await waitForActivePanePtyId(helixPage)
  const targetName = await helixPage.evaluate((id) => {
    const state = window.__store!.getState()
    const worktree = state.getKnownWorktreeById(id)
    if (!worktree) {
      throw new Error('Missing target workspace')
    }
    return worktree.branch.replace(/^refs\/heads\//, '')
  }, target)
  await switchToWorktree(helixPage, source)
  await helixPage.evaluate(async (id) => {
    await window.__store!.getState().shutdownWorktreeTerminals(id, { keepIdentifiers: true })
  }, target)
  await helixPage.evaluate(() => {
    const listSessions = window.api.pty.listSessions
    window.api.pty.listSessions = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return listSessions(...args)
    }
  })
  // Native menu accelerators require OS focus; open the same palette in the hidden renderer.
  await helixPage.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  const dialog = helixPage.getByRole('dialog', { name: 'Jump to...' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill(targetName)
  await expect(dialog.locator('[cmdk-item][data-selected="true"]')).toContainText(targetName)
  const cdp = await helixPage.context().newCDPSession(helixPage)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await helixPage.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await waitForActiveTerminalManager(helixPage)
  await waitForActivePanePtyId(helixPage)
  const terminal = helixPage
    .locator('[data-terminal-tab-id]:visible .xterm-helper-textarea')
    .first()
  await helixPage.screenshot({ path: testInfo.outputPath('wake-focus.png') })
  await expect(terminal).toBeFocused()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()
  await helixPage.keyboard.type('echo WAKE_KEYBOARD_OK')
  await helixPage.keyboard.press('Enter')
  await waitForTerminalOutput(helixPage, 'WAKE_KEYBOARD_OK')
  await helixPage.screenshot({ path: testInfo.outputPath('wake-typing.png') })
})
