// history, reload, zoom, and address-bar chords act on the split that sent them.

import type { Page } from '@playwright/test'
import { expect, test } from './helpers/helix-app'
import { focusActiveTerminalInput } from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  browserOverlay,
  createBrowserSplit,
  createTerminalBrowserSplit,
  focusBrowserGroup,
  guestModifier,
  pressKeyInBrowserGuest,
  shortcutModifier,
  waitForFocusedGroup,
  type BrowserSplitFixture,
  type GuestModifier
} from './helpers/browser-split-fixture'
import {
  guestLoadStarts,
  guestUrl,
  guestZoomLevel,
  navigateGuest,
  recordGuestLoadStarts,
  waitForGuestIdle,
  waitForGuestUrl
} from './helpers/browser-split-guest-probes'
import {
  startBrowserSplitPageServer,
  type BrowserSplitPageServer
} from './helpers/browser-split-page-server'

type Chord = { renderer: string; guestKeyCode: string; guestModifiers: GuestModifier[] }

const isMac = process.platform === 'darwin'
// Default bindings for browser.back / browser.forward / browser.reload / browser.hardReload.
const backChord: Chord = isMac
  ? { renderer: 'Meta+BracketLeft', guestKeyCode: '[', guestModifiers: ['meta'] }
  : { renderer: 'Alt+ArrowLeft', guestKeyCode: 'Left', guestModifiers: ['alt'] }
const forwardChord: Chord = isMac
  ? { renderer: 'Meta+BracketRight', guestKeyCode: ']', guestModifiers: ['meta'] }
  : { renderer: 'Alt+ArrowRight', guestKeyCode: 'Right', guestModifiers: ['alt'] }
const reloadChord: Chord = {
  renderer: `${shortcutModifier}+r`,
  guestKeyCode: 'R',
  guestModifiers: [guestModifier]
}
const hardReloadChord: Chord = {
  renderer: `${shortcutModifier}+Shift+R`,
  guestKeyCode: 'R',
  guestModifiers: [guestModifier, 'shift']
}

async function pressInGuest(
  page: Page,
  fixture: BrowserSplitFixture,
  chord: Pick<Chord, 'guestKeyCode' | 'guestModifiers'>
): Promise<void> {
  await pressKeyInBrowserGuest(
    page,
    fixture.firstBrowserTabId,
    fixture.firstBrowserPageId,
    chord.guestKeyCode,
    chord.guestModifiers
  )
}

/** Two browser splits, each on its second page so both have somewhere to go back to. */
async function createBrowserSplitWithHistory(
  page: Page,
  server: BrowserSplitPageServer
): Promise<BrowserSplitFixture> {
  const fixture = await createBrowserSplit(page, {
    first: server.pageUrl('a', 1),
    second: server.pageUrl('b', 1, 'localhost')
  })
  await waitForGuestUrl(page, fixture.firstBrowserTabId, server.pageUrl('a', 1))
  await waitForGuestUrl(page, fixture.secondBrowserTabId, server.pageUrl('b', 1, 'localhost'))
  await navigateGuest(page, fixture.firstBrowserTabId, server.pageUrl('a', 2))
  await navigateGuest(page, fixture.secondBrowserTabId, server.pageUrl('b', 2, 'localhost'))
  await waitForGuestIdle(page, fixture.firstBrowserTabId)
  await waitForGuestIdle(page, fixture.secondBrowserTabId)
  await recordGuestLoadStarts(page, [fixture.firstBrowserTabId, fixture.secondBrowserTabId])
  return fixture
}

async function expectSecondSplitUntouched(
  page: Page,
  fixture: BrowserSplitFixture,
  server: BrowserSplitPageServer
): Promise<void> {
  await waitForGuestIdle(page, fixture.firstBrowserTabId)
  expect(await guestLoadStarts(page, fixture.secondBrowserTabId)).toBe(0)
  expect(await guestUrl(page, fixture.secondBrowserTabId)).toBe(server.pageUrl('b', 2, 'localhost'))
}

async function expectFirstSplitReloaded(page: Page, fixture: BrowserSplitFixture): Promise<void> {
  await expect.poll(() => guestLoadStarts(page, fixture.firstBrowserTabId)).toBeGreaterThan(0)
}

test.describe('browser split navigation shortcuts', () => {
  let server: BrowserSplitPageServer

  test.beforeEach(async ({ helixPage }) => {
    server = await startBrowserSplitPageServer()
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
    await ensureTerminalVisible(helixPage)
  })

  test.afterEach(async () => {
    await server.close()
  })

  test('Back and Forward typed in one guest move only that split', async ({ helixPage }) => {
    const fixture = await createBrowserSplitWithHistory(helixPage, server)

    await pressInGuest(helixPage, fixture, backChord)
    await waitForGuestUrl(helixPage, fixture.firstBrowserTabId, server.pageUrl('a', 1))
    await expectSecondSplitUntouched(helixPage, fixture, server)

    await pressInGuest(helixPage, fixture, forwardChord)
    await waitForGuestUrl(helixPage, fixture.firstBrowserTabId, server.pageUrl('a', 2))
    await expectSecondSplitUntouched(helixPage, fixture, server)
  })

  test('Reload and Hard Reload typed in one guest reload only that split', async ({
    helixPage
  }) => {
    const fixture = await createBrowserSplitWithHistory(helixPage, server)

    await pressInGuest(helixPage, fixture, reloadChord)
    await expectFirstSplitReloaded(helixPage, fixture)
    await expectSecondSplitUntouched(helixPage, fixture, server)

    await recordGuestLoadStarts(helixPage, [fixture.firstBrowserTabId])
    await pressInGuest(helixPage, fixture, hardReloadChord)
    await expectFirstSplitReloaded(helixPage, fixture)
    await expectSecondSplitUntouched(helixPage, fixture, server)
    expect(await guestUrl(helixPage, fixture.firstBrowserTabId)).toBe(server.pageUrl('a', 2))
  })

  // Ctrl+wheel is not covered: before-mouse-event only fires for OS input, not sendInputEvent.
  test('page zoom typed in one guest zooms only that split', async ({ helixPage }) => {
    const fixture = await createBrowserSplitWithHistory(helixPage, server)
    const firstZoom = (): Promise<number | null> =>
      guestZoomLevel(helixPage, fixture.firstBrowserTabId)
    const secondZoom = (): Promise<number | null> =>
      guestZoomLevel(helixPage, fixture.secondBrowserTabId)
    const initialFirstZoom = await firstZoom()
    const initialSecondZoom = await secondZoom()
    expect(initialFirstZoom).not.toBeNull()

    await pressInGuest(helixPage, fixture, { guestKeyCode: '=', guestModifiers: [guestModifier] })
    await expect.poll(firstZoom).toBeGreaterThan(initialFirstZoom ?? 0)
    expect(await secondZoom()).toBe(initialSecondZoom)

    await pressInGuest(helixPage, fixture, { guestKeyCode: '-', guestModifiers: [guestModifier] })
    await pressInGuest(helixPage, fixture, { guestKeyCode: '-', guestModifiers: [guestModifier] })
    await expect.poll(firstZoom).toBeLessThan(initialFirstZoom ?? 0)
    expect(await secondZoom()).toBe(initialSecondZoom)
  })

  test('Focus Address Bar typed in one guest focuses only that split', async ({ helixPage }) => {
    const fixture = await createBrowserSplitWithHistory(helixPage, server)

    await pressInGuest(helixPage, fixture, { guestKeyCode: 'L', guestModifiers: [guestModifier] })

    await expect(browserAddressBar(helixPage, fixture.firstBrowserTabId)).toBeFocused()
    await expect(browserAddressBar(helixPage, fixture.secondBrowserTabId)).not.toBeFocused()
  })

  test('Back and Reload pressed from one split toolbar act on only that split', async ({
    helixPage
  }) => {
    const fixture = await createBrowserSplitWithHistory(helixPage, server)
    const reloadButton = browserOverlay(helixPage, fixture.firstBrowserTabId).getByRole('button', {
      name: 'Reload',
      exact: true
    })

    await reloadButton.focus()
    await waitForFocusedGroup(helixPage, fixture.firstBrowserGroupId)
    await helixPage.keyboard.press(backChord.renderer)
    await waitForGuestUrl(helixPage, fixture.firstBrowserTabId, server.pageUrl('a', 1))
    await expectSecondSplitUntouched(helixPage, fixture, server)

    await recordGuestLoadStarts(helixPage, [fixture.firstBrowserTabId])
    await reloadButton.focus()
    await helixPage.keyboard.press(reloadChord.renderer)
    await expectFirstSplitReloaded(helixPage, fixture)
    await expectSecondSplitUntouched(helixPage, fixture, server)
  })

  test('Back and Reload pressed in a focused terminal leave the browser split alone', async ({
    helixPage
  }) => {
    const fixture = await createTerminalBrowserSplit(helixPage, server.pageUrl('a', 1))
    await waitForGuestUrl(helixPage, fixture.browserTabId, server.pageUrl('a', 1))
    await navigateGuest(helixPage, fixture.browserTabId, server.pageUrl('a', 2))
    await waitForGuestIdle(helixPage, fixture.browserTabId)
    await recordGuestLoadStarts(helixPage, [fixture.browserTabId])

    await focusBrowserGroup(helixPage, fixture.terminalGroupId)
    await focusActiveTerminalInput(helixPage)
    await waitForFocusedGroup(helixPage, fixture.terminalGroupId)
    await helixPage.keyboard.press(backChord.renderer)
    await helixPage.keyboard.press(reloadChord.renderer)
    await helixPage.keyboard.press(hardReloadChord.renderer)
    // Why: the next toolbar press proves these chords reach the pane in this app; it only has to lose here.
    const reloadButton = browserOverlay(helixPage, fixture.browserTabId).getByRole('button', {
      name: 'Reload',
      exact: true
    })
    await waitForGuestIdle(helixPage, fixture.browserTabId)
    expect(await guestLoadStarts(helixPage, fixture.browserTabId)).toBe(0)
    expect(await guestUrl(helixPage, fixture.browserTabId)).toBe(server.pageUrl('a', 2))

    await reloadButton.focus()
    await waitForFocusedGroup(helixPage, fixture.browserGroupId)
    await helixPage.keyboard.press(backChord.renderer)
    await waitForGuestUrl(helixPage, fixture.browserTabId, server.pageUrl('a', 1))
  })
})
