// Require @headful WebGL: DOM fallback cannot reproduce canvas staleness after split reparenting.

import { test, expect } from './helpers/helix-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { waitForActiveTerminalManager, waitForPaneCount } from './helpers/terminal'
import {
  createAndActivateWorktreeWithManualSplit,
  removeWorktreeViaStore,
  waitForAllPanesToHaveContent,
  checkWebglState
} from './helpers/dead-terminal'

const STRESS_ITERATIONS = 5

test.describe('Dead Terminal Reproduction @headful', () => {
  const createdWorktreeIds: string[] = []

  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
    await ensureTerminalVisible(helixPage)
  })

  test.afterEach(async ({ helixPage }) => {
    for (const id of createdWorktreeIds) {
      await removeWorktreeViaStore(helixPage, id)
    }
    createdWorktreeIds.length = 0
  })

  test('@headful manual-split flow does not produce dead terminals', async ({ helixPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(helixPage)
    await waitForActiveTerminalManager(helixPage, 30_000)
    await checkWebglState(helixPage, 'home-initial')

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const direction = i % 2 === 0 ? 'vertical' : 'horizontal'
      const newId = await createAndActivateWorktreeWithManualSplit(
        helixPage,
        `setup-${i}`,
        direction
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(helixPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(helixPage)
      await waitForActiveTerminalManager(helixPage, 30_000)
      await waitForPaneCount(helixPage, 2, 15_000)
      await checkWebglState(helixPage, `setup-${i}`)
      await waitForAllPanesToHaveContent(helixPage, `setup-${i} both panes`)

      await switchToWorktree(helixPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(helixPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(helixPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful manual-split then switch-back does not leave panes dead', async ({
    helixPage
  }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(helixPage)
    await waitForActiveTerminalManager(helixPage, 30_000)

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const newId = await createAndActivateWorktreeWithManualSplit(
        helixPage,
        `switchback-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(helixPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(helixPage)
      await waitForActiveTerminalManager(helixPage, 30_000)
      await waitForPaneCount(helixPage, 2, 15_000)
      await waitForAllPanesToHaveContent(helixPage, `switchback-${i} initial`)

      await switchToWorktree(helixPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(helixPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await ensureTerminalVisible(helixPage)
      await waitForActiveTerminalManager(helixPage, 15_000)

      await switchToWorktree(helixPage, newId)
      await expect.poll(async () => getActiveWorktreeId(helixPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(helixPage)
      await waitForActiveTerminalManager(helixPage, 15_000)
      await waitForAllPanesToHaveContent(helixPage, `switchback-${i} after return`)

      await switchToWorktree(helixPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(helixPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(helixPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful rapid switching between many manual-split worktrees', async ({ helixPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(helixPage)
    await waitForActiveTerminalManager(helixPage, 30_000)

    const worktreeIds = [homeWorktreeId]
    for (let i = 0; i < 4; i++) {
      const newId = await createAndActivateWorktreeWithManualSplit(
        helixPage,
        `multi-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)
      worktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(helixPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(helixPage)
      await waitForActiveTerminalManager(helixPage, 30_000)
      await waitForPaneCount(helixPage, 2, 15_000)
      await waitForAllPanesToHaveContent(helixPage, `multi-create-${i}`)
    }

    for (let round = 0; round < 3; round++) {
      for (const wId of worktreeIds) {
        await switchToWorktree(helixPage, wId)
        await expect.poll(async () => getActiveWorktreeId(helixPage), { timeout: 10_000 }).toBe(wId)
        await ensureTerminalVisible(helixPage)
        await waitForActiveTerminalManager(helixPage, 15_000)
        await waitForAllPanesToHaveContent(helixPage, `multi-r${round}-${wId.slice(0, 8)}`)
      }
    }
  })
})
