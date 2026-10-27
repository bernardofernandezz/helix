// Real clicks must reach React note controls inside Monaco view zones; propagation or overlay regressions escape store-only tests.

import { test, expect } from './helpers/helix-app'
import { waitForSessionReady, waitForActiveWorktree } from './helpers/store'

test.describe('Diff note delete', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
  })

  test('clicking the trash button removes the saved note', async ({ helixPage }) => {
    const worktreeId = await waitForActiveWorktree(helixPage)

    // Modify a tracked fixture so Monaco renders a real diff instead of an empty state.
    const { relativePath } = await helixPage.evaluate(async (wId) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available — is the app in dev mode?')
      }
      const state = store.getState()
      const worktree = Object.values(state.worktreesByRepo)
        .flat()
        .find((entry) => entry.id === wId)
      if (!worktree) {
        throw new Error('active worktree not found')
      }
      const separator = worktree.path.includes('\\') ? '\\' : '/'
      const rel = `src${separator}index.ts`
      const absolutePath = `${worktree.path}${separator}${rel}`
      await window.api.fs.writeFile({
        filePath: absolutePath,
        content: 'export const hello = "note-test"\n'
      })
      return { relativePath: rel }
    }, worktreeId)

    // Seed the note directly to isolate delete from the separate gutter-hover interaction.
    const addResult = await helixPage.evaluate(
      async ({ wId, rel }) => {
        const store = window.__store
        if (!store) {
          throw new Error('window.__store is not available')
        }
        const comment = await store.getState().addDiffComment({
          worktreeId: wId,
          filePath: rel,
          source: 'diff',
          lineNumber: 1,
          body: 'delete-me note',
          side: 'modified'
        })
        return comment
      },
      { wId: worktreeId, rel: relativePath }
    )
    expect(addResult, 'addDiffComment returned null').not.toBeNull()
    const commentId = addResult!.id

    await helixPage.evaluate(
      ({ wId, rel }) => {
        const store = window.__store
        if (!store) {
          throw new Error('window.__store is not available')
        }
        const state = store.getState()
        const worktree = Object.values(state.worktreesByRepo)
          .flat()
          .find((entry) => entry.id === wId)
        if (!worktree) {
          throw new Error('active worktree not found')
        }
        const separator = worktree.path.includes('\\') ? '\\' : '/'
        state.openDiff(wId, `${worktree.path}${separator}${rel}`, rel, 'typescript', false)
      },
      { wId: worktreeId, rel: relativePath }
    )

    // Wait for the trash button itself to prove the React root inside Monaco’s zone mounted.
    const deleteButton = helixPage.getByTitle('Delete note').first()
    await expect(deleteButton).toBeVisible({ timeout: 15_000 })

    await deleteButton.click()

    await expect
      .poll(
        async () =>
          helixPage.evaluate((id: string) => {
            const store = window.__store
            if (!store) {
              return null
            }
            const all = Object.values(store.getState().worktreesByRepo)
              .flat()
              .flatMap((w) => w.diffComments ?? [])
            return all.some((c) => c.id === id)
          }, commentId),
        {
          timeout: 5_000,
          message: 'deleteDiffComment did not remove the comment from the store'
        }
      )
      .toBe(false)

    await expect(helixPage.getByTitle('Delete note')).toHaveCount(0, {
      timeout: 5_000
    })
  })
})
