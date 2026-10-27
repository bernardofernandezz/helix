//  follow-up: the floating browser and a focused split browser each answer only the
// chrome chords pressed inside them.

import type { Page } from '@playwright/test'
import { expect, test } from './helpers/helix-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  browserOverlay,
  createTerminalBrowserSplit,
  focusBrowserGroup,
  pressKeyInBrowserGuest,
  shortcutModifier
} from './helpers/browser-split-fixture'
import {
  guestLoadStarts,
  navigateGuest,
  recordGuestLoadStarts,
  waitForGuestIdle,
  waitForGuestUrl
} from './helpers/browser-split-guest-probes'
import { startBrowserSplitPageServer } from './helpers/browser-split-page-server'

// Why: mirrors FLOATING_TERMINAL_WORKTREE_ID in src/shared/constants.ts.
const FLOATING_WORKTREE_ID = 'global-floating-terminal'
const FLOATING_PANEL = '[data-floating-terminal-panel]'
const isMac = process.platform === 'darwin'
const backChord = isMac ? 'Meta+BracketLeft' : 'Alt+ArrowLeft'
const forwardChord = isMac ? 'Meta+BracketRight' : 'Alt+ArrowRight'

async function openFloatingBrowser(
  page: Page,
  url: string
): Promise<{ browserTabId: string; browserPageId: string }> {
  const floating = await page.evaluate(
    ({ worktreeId, initialUrl }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      const settings = store.getState().settings
      if (!settings) {
        throw new Error('Settings are not loaded')
      }
      store.setState({ settings: { ...settings, floatingTerminalEnabled: true } })
      const state = store.getState()
      const tab = state.createBrowserTab(worktreeId, initialUrl, {
        activate: true,
        focusAddressBar: false,
        targetGroupId: state.ensureWorktreeRootGroup(worktreeId),
        browserRuntimeEnvironmentId: null
      })
      if (!tab.activePageId) {
        throw new Error('Floating browser page unavailable')
      }
      return { browserTabId: tab.id, browserPageId: tab.activePageId }
    },
    { worktreeId: FLOATING_WORKTREE_ID, initialUrl: url }
  )
  // Why: the toggle listener closes over floatingTerminalEnabled, so wait for the panel to mount.
  await expect(page.locator(FLOATING_PANEL)).toHaveCount(1)
  const openPanel = page.locator(`${FLOATING_PANEL}[aria-hidden="false"]`)
  if ((await openPanel.count()) === 0) {
    await page.evaluate(() => window.dispatchEvent(new Event('helix-toggle-floating-terminal')))
  }
  await expect(
    openPanel.locator(`[data-browser-overlay-tab-id="${floating.browserTabId}"]`)
  ).toBeVisible()
  return floating
}

function findInput(page: Page, browserTabId: string) {
  return browserOverlay(page, browserTabId).getByPlaceholder('Find in page...')
}

function cancelGrabButton(page: Page, browserTabId: string) {
  return browserOverlay(page, browserTabId).getByRole('button', {
    name: 'Cancel',
    exact: true
  })
}

// Why: a non-editable chrome target, so reload and grab are not skipped as text-field keys.
async function focusChrome(page: Page, browserTabId: string): Promise<void> {
  // Reload stays in the toolbar when narrow panes fold their element tools into the menu.
  const target = browserOverlay(page, browserTabId).getByRole('button', {
    name: 'Reload',
    exact: true
  })
  await expect(target).toBeEnabled()
  await target.focus()
  await expect(target).toBeFocused()
}

test.describe('floating browser shortcut scope', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
    await ensureTerminalVisible(helixPage)
  })

  test('chrome shortcuts act only in the pane that owns the key press', async ({ helixPage }) => {
    const server = await startBrowserSplitPageServer()
    try {
      const split = await createTerminalBrowserSplit(helixPage, server.pageUrl('split', 1))
      const floating = await openFloatingBrowser(helixPage, server.pageUrl('float', 1))
      await focusBrowserGroup(helixPage, split.browserGroupId)
      await waitForGuestUrl(helixPage, split.browserTabId, server.pageUrl('split', 1))
      await waitForGuestUrl(helixPage, floating.browserTabId, server.pageUrl('float', 1))
      await navigateGuest(helixPage, split.browserTabId, server.pageUrl('split', 2))
      await navigateGuest(helixPage, floating.browserTabId, server.pageUrl('float', 2))

      const cases = [
        {
          name: 'float',
          owner: floating.browserTabId,
          other: split.browserTabId,
          otherName: 'split'
        },
        {
          name: 'split',
          owner: split.browserTabId,
          other: floating.browserTabId,
          otherName: 'float'
        }
      ]
      for (const { name, owner, other, otherName } of cases) {
        await test.step(`keys pressed in the ${name} browser chrome`, async () => {
          await focusChrome(helixPage, owner)
          await helixPage.keyboard.press(backChord)
          await waitForGuestUrl(helixPage, owner, server.pageUrl(name, 1))
          await waitForGuestIdle(helixPage, other)
          await waitForGuestUrl(helixPage, other, server.pageUrl(otherName, 2))
          await focusChrome(helixPage, owner)
          await helixPage.keyboard.press(forwardChord)
          await waitForGuestUrl(helixPage, owner, server.pageUrl(name, 2))
          await waitForGuestUrl(helixPage, other, server.pageUrl(otherName, 2))

          await recordGuestLoadStarts(helixPage, [owner, other])
          await focusChrome(helixPage, owner)
          await helixPage.keyboard.press(`${shortcutModifier}+r`)
          await expect.poll(() => guestLoadStarts(helixPage, owner)).toBeGreaterThan(0)
          await waitForGuestIdle(helixPage, owner)
          expect(await guestLoadStarts(helixPage, other)).toBe(0)

          await focusChrome(helixPage, owner)
          await helixPage.keyboard.press(`${shortcutModifier}+f`)
          await expect(findInput(helixPage, owner)).toBeFocused()
          await expect(findInput(helixPage, other)).toBeHidden()
          await helixPage.keyboard.press('Escape')
          await expect(findInput(helixPage, owner)).toBeHidden()

          await focusChrome(helixPage, owner)
          await helixPage.keyboard.press(`${shortcutModifier}+l`)
          await expect(browserAddressBar(helixPage, owner)).toBeFocused()

          await focusChrome(helixPage, owner)
          await helixPage.keyboard.press(`${shortcutModifier}+c`)
          await expect(cancelGrabButton(helixPage, owner)).toBeVisible()
          await expect(cancelGrabButton(helixPage, other)).toBeHidden()
          await cancelGrabButton(helixPage, owner).click()
          await expect(cancelGrabButton(helixPage, owner)).toBeHidden()
        })
      }

      await test.step('back pressed inside the floating page', async () => {
        await pressKeyInBrowserGuest(
          helixPage,
          floating.browserTabId,
          floating.browserPageId,
          isMac ? '[' : 'Left',
          [isMac ? 'meta' : 'alt']
        )
        await waitForGuestUrl(helixPage, floating.browserTabId, server.pageUrl('float', 1))
        await waitForGuestUrl(helixPage, split.browserTabId, server.pageUrl('split', 2))
      })
    } finally {
      await server.close()
    }
  })
})
