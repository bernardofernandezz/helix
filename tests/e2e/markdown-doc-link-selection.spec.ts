import { test, expect } from './helpers/helix-app'
import type { Editor } from '@tiptap/core'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'
import { waitForSessionReady, waitForActiveWorktree } from './helpers/store'

type PageRichMarkdownLinkEditorElement = HTMLElement & {
  editor?: Editor
}

test('collapses a selection beside a document link without rewriting the link', async ({
  helixPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  const context = await getActiveWorktreeContext(helixPage)
  const filePath = await createMarkdownFixture(
    context,
    '.helix-e2e-markdown-links',
    'selection',
    testInfo.workerIndex,
    '[[Guide]]after\n\nSelecting text beside a document link should keep the link intact.'
  )
  registerPostElectronShutdownCleanup(() => cleanupMarkdownFixture(filePath))
  await openMarkdownFixture(helixPage, context, filePath)
  const editor = await waitForRichMarkdownEditor(helixPage)
  await expect(editor.locator('[data-doc-link-target="Guide"]')).toHaveCount(1)
  await helixPage.evaluate(() => {
    const editorElement =
      document.querySelector<PageRichMarkdownLinkEditorElement>('.rich-markdown-editor')
    const instance = editorElement?.editor
    if (!editorElement || !instance) {
      throw new Error('Editor unavailable')
    }
    editorElement.focus()
    if (!instance.commands.setTextSelection({ from: 2, to: 7 })) {
      throw new Error('Selection unavailable')
    }
  })
  await expect.poll(() => helixPage.evaluate(() => window.getSelection()?.toString())).toBe('after')
  await expect
    .poll(() =>
      helixPage.evaluate(() => {
        const selection =
          document.querySelector<PageRichMarkdownLinkEditorElement>('.rich-markdown-editor')?.editor
            ?.state.selection
        return selection ? { from: selection.from, to: selection.to, empty: selection.empty } : null
      })
    )
    .toEqual({ from: 2, to: 7, empty: false })
  await expect(editor).toBeFocused()
  await helixPage.keyboard.press('ArrowLeft')
  await expect(editor.locator('[data-doc-link-target="Guide"]')).toHaveCount(1)
  await expect(editor.locator('p').first()).toHaveText('Guideafter')
  await expect.poll(() => helixPage.evaluate(() => window.getSelection()?.toString())).toBe('')
  await helixPage.screenshot({ path: testInfo.outputPath('link-after-collapse.png') })
})
