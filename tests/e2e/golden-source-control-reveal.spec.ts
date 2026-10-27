import path from 'node:path'
import { test, expect } from './helpers/helix-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  GOLDEN_CHANGED_PATH,
  openGoldenSourceControl,
  seedGoldenSourceEdit
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

// Keep separate from the open-diff golden that release-cut restores onto tags predating this menu item.
test('@golden offers to reveal a changed file in the OS file manager from its Source Control row', async ({
  helixPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  const fixture = createGoldenWorktree(testRepoPath, 'reveal-row')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  seedGoldenSourceEdit(fixture.worktreePath)

  await waitForSessionReady(helixPage)
  await openGoldenSourceControl(helixPage, testRepoPath, fixture)

  const changedFile = helixPage
    .locator('[data-testid="source-control-entry"]')
    .filter({ hasText: path.basename(GOLDEN_CHANGED_PATH) })
  await expect(changedFile).toBeVisible({ timeout: 15_000 })
  await changedFile.click({ button: 'right' })

  await expect(
    helixPage.getByRole('menuitem', {
      name: /Reveal in Finder|Reveal in File Explorer|Open Containing Folder/
    })
  ).toBeEnabled()
})
