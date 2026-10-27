import { expect, test } from './helpers/helix-app'
import { openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  helixPage
}) => {
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  await openFileExplorer(helixPage)

  const readmeRow = helixPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(helixPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  await pressShortcut(helixPage, 'f')

  await expect(
    helixPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
