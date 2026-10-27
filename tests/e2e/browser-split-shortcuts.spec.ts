import { expect, test } from './helpers/helix-app'
import type { Page } from '@playwright/test'
import { focusActiveTerminalInput } from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  createBrowserSplit,
  createTerminalBrowserSplit,
  focusBrowserAddressBar,
  focusBrowserGroup,
  guestModifier,
  pressKeyInBrowserGuest,
  shortcutModifier as modifier,
  waitForFocusedGroup
} from './helpers/browser-split-fixture'

function browserFindInput(page: Page) {
  return page.getByPlaceholder('Find in page...')
}

function browserFindCloseButton(page: Page) {
  return browserFindInput(page).locator('xpath=..').getByTitle('Close')
}

function browserSplitFindInput(page: Page, browserTabId: string) {
  return page
    .locator(`[data-browser-overlay-tab-id="${browserTabId}"]`)
    .getByPlaceholder('Find in page...')
}

async function pressFindInBrowserGuest(
  page: Page,
  browserTabId: string,
  browserPageId: string
): Promise<void> {
  await pressKeyInBrowserGuest(page, browserTabId, browserPageId, 'F', [guestModifier])
}

function terminalFindInput(page: Page) {
  return page.locator('[data-terminal-search-root] input:visible')
}

test.describe('browser split shortcuts', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
    await ensureTerminalVisible(helixPage)
  })

  test('routes repeated Find shortcuts to the focused terminal or browser split', async ({
    helixPage
  }) => {
    const fixture = await createTerminalBrowserSplit(helixPage)

    await helixPage.evaluate(({ terminalGroupId }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (state && worktreeId) {
        state.focusGroup(worktreeId, terminalGroupId)
      }
    }, fixture)
    await focusActiveTerminalInput(helixPage)
    await waitForFocusedGroup(helixPage, fixture.terminalGroupId)
    await helixPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(helixPage)).toBeFocused()
    await expect(browserFindInput(helixPage)).toBeHidden()
    await helixPage.keyboard.press('Escape')

    await focusBrowserGroup(helixPage, fixture.browserGroupId)
    await focusBrowserAddressBar(helixPage, fixture.browserTabId)
    await helixPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(helixPage)).toBeFocused()
    await expect(terminalFindInput(helixPage)).toBeHidden()
    await browserFindCloseButton(helixPage).click()
    await expect(browserFindInput(helixPage)).toBeHidden()

    await helixPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(helixPage)).toBeFocused()
    await browserFindCloseButton(helixPage).click()

    await helixPage.evaluate(({ browserTabId }) => {
      window.__store?.getState().closeBrowserTab(browserTabId)
    }, fixture)
    await expect(
      helixPage.locator(`[data-browser-overlay-tab-id="${fixture.browserTabId}"]`)
    ).toHaveCount(0)

    await focusActiveTerminalInput(helixPage)
    await helixPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(helixPage)).toBeFocused()
    await expect(browserFindInput(helixPage)).toBeHidden()
  })

  test('opens Find only in the browser split whose guest owns the shortcut', async ({
    helixPage
  }) => {
    const fixture = await createBrowserSplit(helixPage)

    await pressFindInBrowserGuest(helixPage, fixture.firstBrowserTabId, fixture.firstBrowserPageId)

    await expect(browserSplitFindInput(helixPage, fixture.firstBrowserTabId)).toBeVisible()
    await expect(browserSplitFindInput(helixPage, fixture.secondBrowserTabId)).toBeHidden()
    await expect
      .poll(() =>
        helixPage.evaluate(
          ({ browserPageId, browserTabId }) =>
            window.__store
              ?.getState()
              .browserPagesByWorkspace[browserTabId]?.find((page) => page.id === browserPageId)
              ?.loadError?.code ?? null,
          {
            browserPageId: fixture.firstBrowserPageId,
            browserTabId: fixture.firstBrowserTabId
          }
        )
      )
      .toBeNull()
  })

  test('keeps browser Find available when split focus state is temporarily missing', async ({
    helixPage
  }) => {
    const fixture = await createTerminalBrowserSplit(helixPage)
    await focusBrowserGroup(helixPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(helixPage, fixture.browserTabId)
    await focusBrowserAddressBar(helixPage, fixture.browserTabId)

    await helixPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => {
        const activeGroupIdByWorktree = { ...state.activeGroupIdByWorktree }
        delete activeGroupIdByWorktree[worktreeId]
        return { activeGroupIdByWorktree }
      })
    })
    await expect(addressBar).toBeFocused()

    await helixPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(helixPage)).toBeFocused()
    await expect(terminalFindInput(helixPage)).toBeHidden()
  })

  test('keeps browser Find available when the focused split ID is stale', async ({ helixPage }) => {
    const fixture = await createTerminalBrowserSplit(helixPage)
    await focusBrowserGroup(helixPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(helixPage, fixture.browserTabId)
    await focusBrowserAddressBar(helixPage, fixture.browserTabId)

    await helixPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => ({
        activeGroupIdByWorktree: {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: 'removed-group'
        }
      }))
    })
    await expect(addressBar).toBeFocused()

    await helixPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(helixPage)).toBeFocused()
    await expect(terminalFindInput(helixPage)).toBeHidden()
  })
})
