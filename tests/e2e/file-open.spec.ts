import { test, expect } from './helpers/helix-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  getActiveTabType,
  getOpenFiles,
  ensureTerminalVisible
} from './helpers/store'
import { clickFileInExplorer, openFileExplorer } from './helpers/file-explorer'

async function switchToTerminal(
  page: Parameters<typeof getActiveWorktreeId>[0],
  worktreeId: string
): Promise<void> {
  await page.evaluate((targetWorktreeId) => {
    const store = window.__store
    if (!store) {
      return
    }

    const state = store.getState()
    const terminalTab = (state.tabsByWorktree[targetWorktreeId] ?? [])[0]
    if (terminalTab) {
      state.setActiveTab(terminalTab.id)
    }
    state.setActiveTabType('terminal', store.getState().activeWorktreeId)
  }, worktreeId)
}

async function switchToEditor(
  page: Parameters<typeof getActiveWorktreeId>[0],
  fileId: string
): Promise<void> {
  await page.evaluate((targetFileId) => {
    const store = window.__store
    if (!store) {
      return
    }

    const state = store.getState()
    if (state.openFiles.some((file) => file.id === targetFileId)) {
      state.setActiveFile(targetFileId)
      state.setActiveTabType('editor', store.getState().activeWorktreeId)
    }
  }, fileId)
}

test.describe('File Open & Markdown Preview', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
    await ensureTerminalVisible(helixPage)
  })

  test('opening the right sidebar shows file explorer', async ({ helixPage }) => {
    await openFileExplorer(helixPage)

    // Assert the rendered explorer shell; store selection alone cannot detect mount failure.
    await expect(helixPage.locator('[data-helix-explorer-shell]')).toBeVisible({ timeout: 5_000 })
  })

  test('clicking a file in the file explorer opens it in an editor tab', async ({ helixPage }) => {
    const worktreeId = (await getActiveWorktreeId(helixPage))!
    await openFileExplorer(helixPage)

    const filesBefore = await getOpenFiles(helixPage, worktreeId)

    const clickedFile = await clickFileInExplorer(helixPage, [
      'package.json',
      'tsconfig.json',
      '.gitignore',
      'README.md'
    ])
    expect(clickedFile).not.toBeNull()

    await expect.poll(async () => getActiveTabType(helixPage), { timeout: 5_000 }).toBe('editor')

    await expect
      .poll(async () => (await getOpenFiles(helixPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThan(filesBefore.length)

    // Assert the rendered path; allow first-open lazy EditorPanel/Monaco/Markdown chunks to mount.
    await expect(helixPage.locator('.editor-header-path').first()).toContainText(clickedFile!, {
      timeout: 20_000
    })
  })

  test('opening a .md file shows markdown content', async ({ helixPage }) => {
    await openFileExplorer(helixPage)
    const clickedFile = await clickFileInExplorer(helixPage, ['README.md', 'CLAUDE.md'])
    expect(clickedFile).not.toBeNull()

    await expect.poll(async () => getActiveTabType(helixPage), { timeout: 5_000 }).toBe('editor')

    // Assert the file’s real heading so a blank editor cannot pass via store state.
    const expectedHeading = clickedFile?.endsWith('README.md')
      ? /Helix E2E Test Repo/i
      : /CLAUDE\.md/i
    // Allow cold EditorPanel → Markdown chunk loading and ProseMirror boot before the heading paints.
    await expect(helixPage.getByRole('heading', { name: expectedHeading, level: 1 })).toBeVisible({
      timeout: 25_000
    })
  })

  test('editor tab retains state when switching to terminal and back', async ({ helixPage }) => {
    const worktreeId = (await getActiveWorktreeId(helixPage))!
    await openFileExplorer(helixPage)

    const clickedFile = await clickFileInExplorer(helixPage, [
      'package.json',
      'tsconfig.json',
      '.gitignore'
    ])
    expect(clickedFile).not.toBeNull()

    await expect.poll(async () => getActiveTabType(helixPage), { timeout: 5_000 }).toBe('editor')

    const openFilesBefore = await getOpenFiles(helixPage, worktreeId)
    expect(openFilesBefore.length).toBeGreaterThan(0)

    const editorFileId = openFilesBefore[0].id

    await switchToTerminal(helixPage, worktreeId)
    await expect
      .poll(async () => getActiveTabType(helixPage), { timeout: 3_000 })
      .not.toBe('editor')

    await switchToEditor(helixPage, editorFileId)
    await expect.poll(async () => getActiveTabType(helixPage), { timeout: 3_000 }).toBe('editor')

    const openFilesAfter = await getOpenFiles(helixPage, worktreeId)
    expect(openFilesAfter.length).toBe(openFilesBefore.length)
    expect(openFilesAfter[0].filePath).toBe(openFilesBefore[0].filePath)
  })
})
