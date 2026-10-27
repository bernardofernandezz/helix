import path from 'node:path'
import { test, expect } from './helpers/helix-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-ordered-list-exit'

// Start with an empty middle row so Backspace can delete it without document-wide Meta+A.
const TABLE_MARKDOWN = `| Name | Value |
| --- | --- |
| keep | a |
|  |  |
| stay | c |
`

const SCRATCH_DIR =
  process.env.HELIX_TABLE_ROW_BACKSPACE_SCREENSHOT_DIR ??
  path.join(process.cwd(), 'test-results', 'table-row-backspace')

async function selectionCellText(page: {
  evaluate: (fn: () => string | null) => Promise<string | null>
}): Promise<string | null> {
  return page.evaluate(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return null
    }
    const node = selection.anchorNode
    if (!node) {
      return null
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    const cell = element?.closest('td, th')
    return cell?.textContent?.trim() ?? null
  })
}

async function tableRowCount(page: {
  evaluate: (fn: () => number) => Promise<number>
}): Promise<number> {
  return page.evaluate(() => {
    const editorRoot = document.querySelector('.rich-markdown-editor')
    if (!editorRoot) {
      return -1
    }
    return editorRoot.querySelectorAll('tr').length
  })
}

test.describe('Markdown table keyboard', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
  })

  test('Tab/Shift-Tab move between cells and empty-row Backspace deletes the row', async ({
    helixPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(helixPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        'table-row-backspace',
        testInfo.workerIndex,
        TABLE_MARKDOWN
      )
      await openMarkdownFixture(helixPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(helixPage)

      await expect(editor.locator('tr')).toHaveCount(4, { timeout: 10_000 })
      await expect(editor.getByText('keep')).toBeVisible()
      await expect(editor.getByText('stay')).toBeVisible()

      await editor.getByText('keep').click()

      await helixPage.keyboard.press('Tab')
      await expect
        .poll(async () => selectionCellText(helixPage), {
          timeout: 5_000,
          message: 'Tab should move from keep → a'
        })
        .toBe('a')

      await helixPage.keyboard.press('Tab')
      await expect
        .poll(async () => selectionCellText(helixPage), {
          timeout: 5_000,
          message: 'Tab should wrap into the empty body row'
        })
        .toBe('')

      await helixPage.keyboard.press('Shift+Tab')
      await expect
        .poll(async () => selectionCellText(helixPage), {
          timeout: 5_000,
          message: 'Shift-Tab should return to previous cell (a)'
        })
        .toBe('a')

      await helixPage.keyboard.press('Enter')
      await expect
        .poll(async () => selectionCellText(helixPage), {
          timeout: 5_000,
          message: 'Enter should move down into the empty body row'
        })
        .toBe('')

      await editor.screenshot({
        path: path.join(SCRATCH_DIR, 'electron-table-row-backspace-before.png')
      })
      await helixPage.screenshot({
        path: path.join(SCRATCH_DIR, 'electron-table-row-backspace-before-window.png')
      })

      await helixPage.keyboard.press('Backspace')

      await expect
        .poll(async () => tableRowCount(helixPage), {
          timeout: 5_000,
          message: 'Empty body row should be removed after Backspace'
        })
        .toBe(3)

      await expect(editor.getByText('keep')).toBeVisible()
      await expect(editor.getByText('stay')).toBeVisible()

      await editor.screenshot({
        path: path.join(SCRATCH_DIR, 'electron-table-row-backspace-after.png')
      })
      await helixPage.screenshot({
        path: path.join(SCRATCH_DIR, 'electron-table-row-backspace-after-window.png')
      })

      // Hold a beat so the video recording captures the final table state.
      await helixPage.waitForTimeout(800)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
