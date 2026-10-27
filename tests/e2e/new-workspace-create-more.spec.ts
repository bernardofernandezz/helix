import { openSidebarWorkspaceComposer } from './helpers/sidebar-project-dialog'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { test, expect } from './helpers/helix-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.use({ helixAppExtraEnv: { HELIX_BACKGROUND_LAUNCH: '1' } })

test('Create more clears the GitHub PR source before the next worktree', async ({
  electronApp,
  helixPage,
  testRepoPath
}, testInfo) => {
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: testRepoPath,
    encoding: 'utf8'
  }).trim()
  await electronApp.evaluate(({ ipcMain }, baseBranch) => {
    ipcMain.removeHandler('worktrees:resolvePrBase')
    ipcMain.handle('worktrees:resolvePrBase', () => ({ baseBranch }))
  }, sha)
  await helixPage.evaluate(() => {
    const store = window.__store!
    const state = store.getState()
    store.setState({ settings: { ...state.settings!, defaultTuiAgent: 'blank' } })
  })
  await openSidebarWorkspaceComposer(helixPage)
  await helixPage.evaluate(() => {
    const store = window.__store!
    const repoId = store.getState().repos[0].id
    const item = {
      id: 'pr-4242',
      provider: 'github' as const,
      type: 'pr' as const,
      number: 4242,
      title: 'Fix workspace task reset',
      state: 'open' as const,
      url: 'https://github.com/acme/app/pull/4242',
      labels: [],
      updatedAt: '2026-09-01T00:00:00Z',
      author: 'e2e',
      repoId
    }
    store.setState({
      getCachedWorkItems: () => [item],
      fetchWorkItems: async () => [item],
      fetchWorkItemsAcrossRepos: async () => ({
        items: [item],
        failedCount: 0,
        githubUnavailable: false
      })
    })
  })
  const dialog = helixPage.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
  const input = dialog.locator('[data-workspace-name-input="true"]')
  await input.click()
  await helixPage
    .getByRole('option', { name: '#4242 Fix workspace task reset', exact: true })
    .click()
  const pill = dialog.locator('[data-workspace-source-pill="true"]')
  await expect(pill).toContainText('Fix workspace task reset')
  await dialog.getByRole('switch', { name: 'Create more' }).click()
  await dialog.getByRole('button', { name: /^Create/ }).click()
  await expect(dialog).toBeVisible()
  await expect(input).toHaveValue('')
  await expect
    .poll(() =>
      helixPage.evaluate(() =>
        window
          .__store!.getState()
          .allWorktrees()
          .some((worktree) => worktree.linkedPR === 4242)
      )
    )
    .toBe(true)
  const cdp = await helixPage.context().newCDPSession(helixPage)
  const screenshot = await cdp.send('Page.captureScreenshot')
  const proofPath = testInfo.outputPath('create-more-result.png')
  writeFileSync(proofPath, Buffer.from(screenshot.data, 'base64'))
  await testInfo.attach('create-more-result.png', {
    path: proofPath,
    contentType: 'image/png'
  })
  await cdp.detach()
  await expect(pill).toHaveCount(0)
  await expect(dialog.getByRole('switch', { name: 'Create more' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await input.fill('next-independent-worktree')
  await dialog.getByRole('button', { name: /^Create/ }).click()
  await expect
    .poll(() =>
      helixPage.evaluate(() => {
        const worktree = window
          .__store!.getState()
          .allWorktrees()
          .find((entry) => entry.displayName === 'next-independent-worktree')
        return worktree ? { linkedPR: worktree.linkedPR, linkedIssue: worktree.linkedIssue } : null
      })
    )
    .toEqual({ linkedPR: null, linkedIssue: null })
  await expect(input).toHaveValue('')
  await expect(pill).toHaveCount(0)
})
