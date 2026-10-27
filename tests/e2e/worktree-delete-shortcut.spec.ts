import { test, expect } from './helpers/helix-app'
import { getAllWorktreeIds, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import { worktreeRow } from './worktree-row-locators'

async function createIsolatedWorktree(
  page: Parameters<typeof waitForActiveWorktree>[0]
): Promise<string> {
  const name = `e2e-delete-shortcut-${Date.now()}`
  return page.evaluate(async (worktreeName) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('No active worktree to derive repo from')
    }
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((candidate) => candidate.id === state.activeWorktreeId)
    if (!worktree) {
      throw new Error('Active worktree was not found')
    }

    const result = await state.createWorktree(worktree.repoId, worktreeName)
    await state.fetchWorktrees(worktree.repoId)
    return result.worktree.id
  }, name)
}

test.describe('Worktree Delete Shortcut', () => {
  let createdWorktreeId: string | null = null

  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
  })

  test.afterEach(async ({ helixPage }) => {
    if (!createdWorktreeId) {
      return
    }
    const worktreeId = createdWorktreeId
    createdWorktreeId = null
    await helixPage
      .evaluate(async (id) => {
        const state = window.__store?.getState()
        await state?.removeWorktree(
          { id, executionHostId: state.getKnownWorktreeById(id)?.hostId ?? null },
          true
        )
      }, worktreeId)
      .catch(() => undefined)
  })

  test('deletes the hovered worktree after Mod+Shift+Backspace confirmation', async ({
    helixPage
  }) => {
    createdWorktreeId = await createIsolatedWorktree(helixPage)
    const worktreeId = createdWorktreeId
    const row = worktreeRow(helixPage, worktreeId)
    await expect(row).toBeVisible()

    await row.hover()
    await pressShortcut(helixPage, 'Backspace', { shift: true })

    const dialog = helixPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete Workspace', exact: true }).click()

    await expect
      .poll(async () => getAllWorktreeIds(helixPage), {
        timeout: 15_000,
        message: 'hovered worktree was not removed by the delete shortcut'
      })
      .not.toContain(worktreeId)
    createdWorktreeId = null
  })
})
