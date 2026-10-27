// Require scrollback retention across tab, pane and worktree changes.

import { test, expect } from './helpers/helix-app'
import {
  discoverActivePtyId,
  execInTerminal,
  closeActiveTerminalPane,
  countVisibleTerminalPanes,
  focusLastTerminalPane,
  splitActiveTerminalPane,
  waitForTerminalOutput,
  waitForPaneCount,
  getTerminalContent
} from './helpers/terminal'
import {
  getActiveWorktreeId,
  getActiveTabType,
  getWorktreeTabs,
  getAllWorktreeIds,
  switchToOtherWorktree,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('terminal pane retains content when switching tabs and back', async ({ helixPage }) => {
    const ptyId = await discoverActivePtyId(helixPage)
    const marker = `RETAIN_TEST_${Date.now()}`
    await execInTerminal(helixPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(helixPage, marker)

    const worktreeId = (await getActiveWorktreeId(helixPage))!
    await pressShortcut(helixPage, 't')

    await expect
      .poll(async () => (await getWorktreeTabs(helixPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)

    const activeType = await getActiveTabType(helixPage)
    expect(activeType).toBe('terminal')

    await pressShortcut(helixPage, 'BracketLeft', { shift: true })

    await expect
      .poll(async () => (await getTerminalContent(helixPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)

    await pressShortcut(helixPage, 'BracketRight', { shift: true })
    await pressShortcut(helixPage, 'w')
  })

  test('terminal pane retains content when splitting and closing a pane', async ({ helixPage }) => {
    const ptyId = await discoverActivePtyId(helixPage)
    const marker = `SPLIT_RETAIN_${Date.now()}`
    await execInTerminal(helixPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(helixPage, marker)

    const panesBefore = await countVisibleTerminalPanes(helixPage)

    await splitActiveTerminalPane(helixPage, 'vertical')
    await waitForPaneCount(helixPage, panesBefore + 1)

    await focusLastTerminalPane(helixPage)
    await closeActiveTerminalPane(helixPage)
    await waitForPaneCount(helixPage, panesBefore)

    await expect
      .poll(async () => (await getTerminalContent(helixPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)
  })

  test('terminal pane retains content when switching worktrees and back', async ({ helixPage }) => {
    const allWorktreeIds = await getAllWorktreeIds(helixPage)
    if (allWorktreeIds.length < 2) {
      test.skip(true, 'Need at least 2 worktrees to test worktree switching')
      return
    }

    const worktreeId = (await getActiveWorktreeId(helixPage))!

    const ptyId = await discoverActivePtyId(helixPage)
    const marker = `WT_RETAIN_${Date.now()}`
    await execInTerminal(helixPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(helixPage, marker)

    const otherId = await switchToOtherWorktree(helixPage, worktreeId)
    expect(otherId).not.toBeNull()
    await expect.poll(async () => getActiveWorktreeId(helixPage), { timeout: 5_000 }).toBe(otherId)

    await switchToWorktree(helixPage, worktreeId)
    await expect
      .poll(async () => getActiveWorktreeId(helixPage), { timeout: 5_000 })
      .toBe(worktreeId)

    // Poll the retained marker after worktree return: serialize-addon rebind can lag the activation cascade, so avoid an earlier manager-timing assertion.
    await ensureTerminalVisible(helixPage)

    await expect
      .poll(async () => (await getTerminalContent(helixPage)).includes(marker), { timeout: 20_000 })
      .toBe(true)
  })
})
