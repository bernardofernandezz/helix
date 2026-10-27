// Require real Chromium sticky layout to dock an overflowed active tab and reveal arrivals without scrolling/flicker; mocked unit geometry cannot prove the drawn dock.

import type { Page } from '@playwright/test'
import { test, expect } from './helpers/helix-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'

const STRIP = '.terminal-tab-strip'

type DockSample = { scrollLeft: number; activeLeft: number; activeRight: number }

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __tabStripDockSamples?: DockSample[]
  }
}

function slotSelector(tabId: string): string {
  return `${STRIP} > [data-tab-strip-slot="${tabId}"]`
}

async function createBackgroundTerminalTab(page: Page, worktreeId: string): Promise<string> {
  return page.evaluate(
    (wId) =>
      window.__store!.getState().createTab(wId, undefined, undefined, { activate: false }).id,
    worktreeId
  )
}

async function readStripSlotIds(page: Page): Promise<string[]> {
  return page.$$eval(`${STRIP} > [data-tab-strip-slot]`, (nodes) =>
    nodes.map((node) => node.getAttribute('data-tab-strip-slot') ?? '')
  )
}

/** Where `tabId` is drawn relative to the strip's visible viewport, in px. */
async function readSlotViewportSpan(
  page: Page,
  tabId: string
): Promise<{ left: number; right: number; viewLeft: number; viewRight: number }> {
  return page.evaluate(
    ({ strip, slot }) => {
      const stripEl = document.querySelector<HTMLElement>(strip)!
      const slotRect = document.querySelector<HTMLElement>(slot)!.getBoundingClientRect()
      const viewLeft = stripEl.getBoundingClientRect().left + stripEl.clientLeft
      return {
        left: slotRect.left,
        right: slotRect.right,
        viewLeft,
        viewRight: viewLeft + stripEl.clientWidth
      }
    },
    { strip: STRIP, slot: slotSelector(tabId) }
  )
}

async function isSlotInView(page: Page, tabId: string): Promise<boolean> {
  const span = await readSlotViewportSpan(page, tabId)
  return span.left >= span.viewLeft - 1 && span.right <= span.viewRight + 1
}

async function nextFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let i = 0; i < frames; i++) {
      await new Promise(requestAnimationFrame)
    }
  }, count)
}

test.describe('Tab strip active-tab dock', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
    await ensureTerminalVisible(helixPage)
  })

  test('docks an offscreen active tab and reveals an arriving tab beside it without flicker', async ({
    helixPage
  }) => {
    const worktreeId = await waitForActiveWorktree(helixPage)
    const strip = helixPage.locator(STRIP).first()
    await expect(strip).toBeVisible()

    for (let i = 0; i < 40; i++) {
      const overflowsTwice = await strip.evaluate((el) => el.scrollWidth > el.clientWidth * 2)
      if (overflowsTwice) {
        break
      }
      await createBackgroundTerminalTab(helixPage, worktreeId)
      await nextFrames(helixPage, 1)
    }
    await expect
      .poll(() => strip.evaluate((el) => el.scrollWidth > el.clientWidth * 2), { timeout: 5_000 })
      .toBe(true)

    const lastTabId = (await readStripSlotIds(helixPage)).at(-1)!
    await helixPage.locator(`${slotSelector(lastTabId)} [data-testid="sortable-tab"]`).click()
    await expect(helixPage.locator(`${slotSelector(lastTabId)} [data-active="true"]`)).toHaveCount(
      1
    )

    // Scroll the active last tab's real spot far out of view; sticky layout must hold it at the end.
    await strip.evaluate((el) => {
      el.scrollLeft = 0
    })
    await expect(strip).toHaveAttribute('data-active-tab-docked', 'end')
    const docked = await readSlotViewportSpan(helixPage, lastTabId)
    expect(Math.abs(docked.right - docked.viewRight)).toBeLessThanOrEqual(1)

    // Why sample every frame: a smooth scroll or a double jump shows up only between assertions.
    await helixPage.evaluate(
      ({ strip: stripSelector, slot }) => {
        const stripEl = document.querySelector<HTMLElement>(stripSelector)!
        const samples: DockSample[] = []
        const sample = (): void => {
          const rect = document.querySelector<HTMLElement>(slot)!.getBoundingClientRect()
          samples.push({
            scrollLeft: stripEl.scrollLeft,
            activeLeft: rect.left,
            activeRight: rect.right
          })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
        window.__tabStripDockSamples = samples
      },
      { strip: STRIP, slot: slotSelector(lastTabId) }
    )

    // The pointer still rests on the strip from the click, so the arriving tab waits for it to leave.
    const arrivingTabId = await createBackgroundTerminalTab(helixPage, worktreeId)
    await expect(helixPage.locator(slotSelector(arrivingTabId))).toHaveCount(1)
    await nextFrames(helixPage, 3)
    expect(await strip.evaluate((el) => el.scrollLeft)).toBe(0)
    expect(await isSlotInView(helixPage, arrivingTabId)).toBe(false)

    const stripBox = (await strip.boundingBox())!
    await helixPage.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height + 200)
    await expect.poll(() => isSlotInView(helixPage, arrivingTabId), { timeout: 3_000 }).toBe(true)
    expect(await isSlotInView(helixPage, lastTabId)).toBe(true)
    await nextFrames(helixPage, 3)

    const finalScrollLeft = await strip.evaluate((el) => el.scrollLeft)
    expect(finalScrollLeft).toBeGreaterThan(0)
    const view = await readSlotViewportSpan(helixPage, lastTabId)
    const samples = await helixPage.evaluate(() => window.__tabStripDockSamples ?? [])
    expect(samples.length).toBeGreaterThan(0)
    for (const sample of samples) {
      // One jump from the docked position to the reveal; any value in between is visible scrolling.
      expect([0, finalScrollLeft]).toContain(sample.scrollLeft)
      expect(sample.activeLeft).toBeGreaterThanOrEqual(view.viewLeft - 1)
      expect(sample.activeRight).toBeLessThanOrEqual(view.viewRight + 1)
    }
  })
})
