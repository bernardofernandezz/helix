import type { Locator, Page } from '@playwright/test'
import { expect, test } from './helpers/helix-app'
import { pressShortcut } from './helpers/shortcuts'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'

const FIRST = 'First alpha paragraph for pointer selection.'
const SECOND = 'Second beta paragraph for pointer selection.'
const SOURCE = [
  '# Adversarial Find interactions',
  'Needle first match.',
  ...Array.from({ length: 65 }, (_, index) => `Spacer ${index} keeps the search match away.`),
  FIRST,
  SECOND,
  '| Left | Right |\n| --- | --- |\n| Cell alpha | Cell beta |\n| Cell gamma | Cell delta |',
  '- [ ] Task marker',
  '<details open>\n<summary>Details marker</summary>\n\nDetails body marker\n\n</details>',
  '```javascript\nconst codeMarker = "clean";\n```',
  'Late target paragraph for a pending query.',
  ...Array.from({ length: 30 }, (_, index) => `Tail spacer ${index} keeps the second match away.`),
  'Needle final match.'
].join('\n\n')

async function textPoint(target: Locator, offset: number) {
  return target.evaluate((element, offset) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let remaining = offset
    let node = walker.nextNode()
    while (node) {
      if (node instanceof Text && remaining <= node.length) {
        const range = document.createRange()
        range.setStart(node, remaining)
        range.collapse(true)
        const bounds = range.getBoundingClientRect()
        return { x: bounds.left, y: bounds.top + bounds.height / 2 }
      }
      remaining -= node.textContent?.length ?? 0
      node = walker.nextNode()
    }
    throw new Error('Text offset was not found')
  }, offset)
}

async function selectedText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() ?? '')
}

async function centered(target: Locator) {
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }))
}

async function find(page: Page, query = 'Needle', status = '1/2') {
  await pressShortcut(page, 'f')
  const input = page.getByRole('textbox', { name: 'Find in rich markdown editor' })
  await expect(input).toBeFocused()
  await input.fill(query)
  await expect(page.locator('.rich-markdown-search-status')).toHaveText(status)
  return input
}

async function drag(page: Page, start: Locator, end: Locator, from: number, to: number) {
  const firstPoint = await textPoint(start, from)
  const lastPoint = await textPoint(end, to)
  await page.mouse.move(firstPoint.x, firstPoint.y)
  await page.mouse.down()
  await page.mouse.move(lastPoint.x, lastPoint.y, { steps: 15 })
  await page.mouse.up()
}

test.beforeEach(async ({ helixPage, registerPostElectronShutdownCleanup }, testInfo) => {
  const context = await getActiveWorktreeContext(helixPage)
  const filePath = await createMarkdownFixture(
    context,
    '.helix-e2e-markdown-adversarial',
    'find-interactions',
    testInfo.workerIndex,
    SOURCE
  )
  registerPostElectronShutdownCleanup(() => cleanupMarkdownFixture(filePath))
  await openMarkdownFixture(helixPage, context, filePath)
  const editor = await waitForRichMarkdownEditor(helixPage)
  await editor.locator('p').first().click()
})

test('Find preserves Shift-click, double-click, and multi-paragraph copy selection', async ({
  helixPage
}, testInfo) => {
  const editor = helixPage.locator('.rich-markdown-editor')
  const first = editor.getByText(FIRST, { exact: true })
  const second = editor.getByText(SECOND, { exact: true })
  const search = await find(helixPage)
  await centered(first)
  const viewport = helixPage.locator('.rich-markdown-editor-shell .overflow-auto')
  const scroll = await viewport.evaluate((element) => element.scrollTop)
  const start = await textPoint(first, 6)
  const end = await textPoint(second, 11)
  await helixPage.mouse.click(start.x, start.y)
  await helixPage.keyboard.down('Shift')
  await helixPage.mouse.click(end.x, end.y)
  await helixPage.keyboard.up('Shift')
  expect(await selectedText(helixPage)).toBe(`${FIRST.slice(6)}\n\n${SECOND.slice(0, 11)}`)
  await expect(editor).toBeFocused()
  await expect(
    helixPage
      .locator('[data-tab-id]')
      .filter({ hasText: 'find-interactions' })
      .last()
      .locator('span.rounded-full')
  ).toHaveCount(0)
  await helixPage.mouse.click(start.x, start.y)
  await search.focus()
  await helixPage.keyboard.down('Shift')
  await helixPage.mouse.click(end.x, end.y)
  await helixPage.keyboard.up('Shift')
  expect(await selectedText(helixPage)).toBe(`${FIRST.slice(6)}\n\n${SECOND.slice(0, 11)}`)
  const copied = await editor.evaluate((element) => {
    const clipboard = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard })
    )
    return { plain: clipboard.getData('text/plain'), html: clipboard.getData('text/html') }
  })
  expect(copied.plain).toContain(FIRST.slice(6))
  expect(copied.plain).toContain(SECOND.slice(0, 11))
  expect(copied.html).toContain('<p>')
  await expect(editor.getByText('Needle first match.', { exact: true })).toBeVisible()
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0)
  await helixPage.screenshot({ path: testInfo.outputPath('shift-click-copy-selection.png') })
  await search.focus()
  const word = await textPoint(first, 9)
  await helixPage.mouse.dblclick(word.x, word.y)
  expect(await selectedText(helixPage)).toBe('alpha')
  await helixPage.keyboard.type('xy', { delay: 100 })
  await expect(
    editor.getByText('First xy paragraph for pointer selection.', { exact: true })
  ).toBeVisible()
  await expect(search).toHaveValue('Needle')
  await expect(helixPage.locator('.rich-markdown-search-status')).toHaveText('1/2')
})

test('Replace input returns to a multi-paragraph drag and explicit next-match navigation', async ({
  helixPage
}, testInfo) => {
  const editor = helixPage.locator('.rich-markdown-editor')
  const search = await find(helixPage)
  await helixPage.getByRole('button', { name: 'Toggle replace', exact: true }).click()
  const replace = helixPage.getByRole('textbox', { name: 'Replace in rich markdown editor' })
  await replace.fill('Thread')
  const first = editor.getByText(FIRST, { exact: true })
  const second = editor.getByText(SECOND, { exact: true })
  await centered(first)
  await drag(helixPage, first, second, 6, 11)
  expect(await selectedText(helixPage)).toBe(`${FIRST.slice(6)}\n\n${SECOND.slice(0, 11)}`)
  await helixPage.keyboard.type('xy', { delay: 100 })
  await expect(
    editor.getByText(`${FIRST.slice(0, 6)}xy${SECOND.slice(11)}`, { exact: true })
  ).toBeVisible()
  await helixPage.getByRole('button', { name: 'Next match', exact: true }).click()
  await expect.poll(() => selectedText(helixPage)).toBe('Needle')
  await expect(helixPage.locator('.rich-markdown-search-status')).toHaveText('2/2')
  await replace.focus()
  await helixPage.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(editor.getByText('Thread final match.', { exact: true })).toBeVisible()
  await expect(helixPage.locator('.rich-markdown-search-status')).toHaveText('1/1')
  await expect(replace).toBeFocused()
  await helixPage.keyboard.press('Escape')
  await expect(search).toHaveCount(0)
  await pressShortcut(helixPage, 'f')
  await expect(search).toBeFocused()
  await expect(search).toHaveValue('')
  await helixPage.screenshot({ path: testInfo.outputPath('replace-next-reopen.png') })
})

test('Find returns focus and copies the intended cells after Shift-clicking a table', async ({
  helixPage
}, testInfo) => {
  const editor = helixPage.locator('.rich-markdown-editor')
  const search = await find(helixPage, 'Cell alpha', '1/1')
  const firstCell = editor.getByText('Cell alpha', { exact: true })
  const lastCell = editor.getByText('Cell delta', { exact: true })
  await centered(firstCell)
  const viewport = helixPage.locator('.rich-markdown-editor-shell .overflow-auto')
  const scroll = await viewport.evaluate((element) => element.scrollTop)
  const point = await textPoint(lastCell, 6)
  await helixPage.keyboard.down('Shift')
  await helixPage.mouse.move(point.x, point.y)
  await helixPage.mouse.down()
  await helixPage.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  await helixPage.mouse.up()
  await helixPage.keyboard.up('Shift')
  await expect(editor.locator('td.selectedCell')).toHaveCount(4)
  await helixPage.screenshot({ path: testInfo.outputPath('shift-cell-selection.png') })
  await expect(editor).toBeFocused()
  await expect(search).toHaveValue('Cell alpha')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0)
  const tab = helixPage.locator('[data-tab-id]').filter({ hasText: 'find-interactions' }).last()
  await expect(tab.locator('span.rounded-full')).toHaveCount(0)
  const copied = await editor.evaluate((element) => {
    const clipboard = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent('copy', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard
      })
    )
    return clipboard.getData('text/plain')
  })
  expect(copied).toBe('Cell alpha\n\nCell beta\n\nCell gamma\n\nCell delta')
})

test('Find preserves embedded task, details, and code editing', async ({ helixPage }, testInfo) => {
  const editor = helixPage.locator('.rich-markdown-editor')
  const search = await find(helixPage)
  await centered(editor.getByRole('checkbox'))
  await search.focus()
  const checkbox = editor.getByRole('checkbox')
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await expect(search).toHaveValue('Needle')
  await search.focus()
  const details = editor.locator('[data-type="details"]')
  await details.getByRole('button').click()
  await expect(details.locator('[data-type="detailsContent"]')).toBeHidden()
  await search.focus()
  await details.getByRole('button').click()
  await expect(details.locator('[data-type="detailsContent"]')).toBeVisible()
  const body = editor.getByText('Details body marker', { exact: true })
  const bodyPoint = await textPoint(body, 7)
  await search.focus()
  await helixPage.mouse.click(bodyPoint.x, bodyPoint.y)
  await helixPage.keyboard.type('xy', { delay: 100 })
  await expect(editor.getByText('Detailsxy body marker', { exact: true })).toBeVisible()
  const code = editor.getByText('const codeMarker = "clean";', { exact: true })
  await centered(code)
  const codePoint = await textPoint(code, 6)
  await search.focus()
  await helixPage.mouse.click(codePoint.x, codePoint.y)
  await helixPage.keyboard.type('xy', { delay: 100 })
  await expect(editor.getByText('const xycodeMarker = "clean";', { exact: true })).toBeVisible()
  await expect(helixPage.locator('.rich-markdown-search-status')).toHaveText('1/2')
  await helixPage.screenshot({ path: testInfo.outputPath('embedded-control-editing.png') })
})

test('a pending Find query cannot claim focus after document and checkbox interaction', async ({
  helixPage
}, testInfo) => {
  const editor = helixPage.locator('.rich-markdown-editor')
  const search = await find(helixPage)
  const target = editor.getByText('Late target paragraph for a pending query.', { exact: true })
  await centered(target)
  const point = await textPoint(target, 5)
  const viewport = helixPage.locator('.rich-markdown-editor-shell .overflow-auto')
  const scroll = await viewport.evaluate((element) => element.scrollTop)
  const checkbox = editor.getByRole('checkbox')
  const checkboxPoint = await checkbox.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  })
  await search.fill('Cell alpha')
  await helixPage.mouse.click(point.x, point.y)
  await expect(editor).toBeFocused()
  await helixPage.mouse.click(checkboxPoint.x, checkboxPoint.y)
  await expect(checkbox).toBeChecked()
  await expect(helixPage.locator('.rich-markdown-search-status')).toHaveText('1/1')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0)
  await expect(target).toHaveText('Late target paragraph for a pending query.')
  await helixPage.mouse.click(point.x, point.y)
  await helixPage.keyboard.type('xy', { delay: 100 })
  await expect(
    editor.getByText('Late xytarget paragraph for a pending query.', { exact: true })
  ).toBeVisible()
  await expect(helixPage.locator('.rich-markdown-search-status')).toHaveText('1/1')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0)
  await expect(search).toHaveValue('Cell alpha')
  await helixPage.screenshot({ path: testInfo.outputPath('pending-query-editor-caret.png') })
})

test('Replace advances when its replacement still contains the search query', async ({
  helixPage
}, testInfo) => {
  const editor = helixPage.locator('.rich-markdown-editor')
  await find(helixPage)
  await helixPage.getByRole('button', { name: 'Toggle replace', exact: true }).click()
  await helixPage.getByRole('textbox', { name: 'Replace in rich markdown editor' }).fill('NeedleX')
  await helixPage.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(editor.getByText('NeedleX first match.', { exact: true })).toBeVisible()
  await expect(helixPage.locator('.rich-markdown-search-status')).toHaveText('2/2')
  await expect(
    editor.getByText('Needle final match.', { exact: true }).locator('[data-active="true"]')
  ).toHaveText('Needle')
  await helixPage.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(editor.getByText('NeedleX final match.', { exact: true })).toBeVisible()
  await expect(editor.getByText('NeedleX first match.', { exact: true })).toBeVisible()
  await expect(helixPage.locator('.rich-markdown-search-status')).toHaveText('1/2')
  await helixPage.screenshot({ path: testInfo.outputPath('replacement-retains-query.png') })
})
