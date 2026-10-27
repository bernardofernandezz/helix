import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { test, expect } from './helpers/helix-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { parkHiddenTabBehindDecoy } from './helpers/terminal-hidden-parking'
import {
  execInTerminal,
  getTerminalContent,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { nodeTerminalCommand } from './terminal-node-command'

const PARKING_DELAY_MS = Number(process.env.HELIX_E2E_TERMINAL_PARKING_DELAY_MS) || 500

test.use({
  helixAppExtraEnv: { HELIX_E2E_TERMINAL_PARKING_DELAY_MS: String(PARKING_DELAY_MS) }
})

async function hasPtySession(page: Page, ptyId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const sessions = await window.api.pty.listSessions()
    return sessions.some((session) => session.id === id)
  }, ptyId)
}

async function createActiveTerminalTab(page: Page, worktreeId: string): Promise<void> {
  const tabId = await page.evaluate((id) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    const state = store.getState()
    const tab = state.createTab(id, undefined, undefined, { activate: true })
    state.setActiveTab(tab.id)
    state.setActiveTabType('terminal', store.getState().activeWorktreeId)
    return tab.id
  }, worktreeId)

  await waitForActiveTerminalManager(page, 30_000)
  expect((await waitForPaneIdentitySnapshot(page, 1)).tabId).toBe(tabId)
}

test('closing a parked terminal tab retires its exact PTY session', async ({ helixPage }) => {
  await waitForSessionReady(helixPage)
  const worktreeId = await waitForActiveWorktree(helixPage)
  await ensureTerminalVisible(helixPage)
  await waitForActiveTerminalManager(helixPage, 30_000)

  const snapshot = await waitForPaneIdentitySnapshot(helixPage, 1)
  const tabId = snapshot.tabId
  const ptyId = snapshot.panes[0]?.ptyId
  if (!ptyId) {
    throw new Error('active terminal pane did not bind a PTY')
  }

  const tab = helixPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
  await expect(tab).toBeVisible()

  const marker = `PARKED_CLOSE_READY_${randomUUID()}`
  const keepAliveScript = `process.stdout.write(${JSON.stringify(`${marker}\n`)}); setInterval(() => {}, 1000)`
  await execInTerminal(helixPage, ptyId, nodeTerminalCommand(['-e', keepAliveScript]))
  await expect
    .poll(() => getTerminalContent(helixPage), {
      timeout: 10_000,
      message: 'long-lived terminal child did not print its ready marker'
    })
    .toContain(marker)
  await expect.poll(() => hasPtySession(helixPage, ptyId), { timeout: 10_000 }).toBe(true)

  // Hide B most recently so it takes the warm exemption while decoy C makes A parkable.
  await createActiveTerminalTab(helixPage, worktreeId)
  await parkHiddenTabBehindDecoy(helixPage, worktreeId, tabId, {
    parkDelayMs: PARKING_DELAY_MS
  })
  // Require PTY survival through parking so early session death cannot satisfy close retirement.
  await expect.poll(() => hasPtySession(helixPage, ptyId), { timeout: 10_000 }).toBe(true)

  await helixPage.evaluate((id) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    store.getState().closeTab(id)
  }, tabId)

  await expect
    .poll(() => hasPtySession(helixPage, ptyId), {
      timeout: 15_000,
      message: `parked tab close did not retire PTY ${ptyId}`
    })
    .toBe(false)
  await expect(tab).toHaveCount(0)
})
