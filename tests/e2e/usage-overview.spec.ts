import { test, expect } from './helpers/helix-app'
import { getStoreState, waitForSessionReady } from './helpers/store'

test.describe('usage overview', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
  })

  test('Stats & Usage opens on the combined overview with provider controls', async ({
    helixPage
  }) => {
    await helixPage.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsPage()
    })

    await expect
      .poll(async () => getStoreState<string>(helixPage, 'activeView'), { timeout: 5_000 })
      .toBe('settings')
    await helixPage.getByRole('button', { name: 'Stats & Usage' }).click()
    await expect(helixPage.getByRole('heading', { name: 'Usage Analytics' })).toBeVisible()
    const providerDropdown = helixPage.getByTestId('usage-provider-select')
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: Overview'
    )
    await expect(helixPage.getByTestId('usage-overview-pane')).toBeVisible()
    await expect(helixPage.getByRole('heading', { name: 'Usage Overview' })).toBeVisible()
    await expect(helixPage.getByRole('heading', { name: 'Providers' })).toBeVisible()
    await expect(helixPage.getByRole('button', { name: 'Enable Claude' })).toBeVisible()
    await expect(helixPage.getByRole('button', { name: 'Enable Codex' })).toBeVisible()
    await expect(helixPage.getByRole('button', { name: 'Enable OpenCode' })).toBeVisible()

    await providerDropdown.click()
    await helixPage.getByRole('menuitem', { name: 'Codex', exact: true }).click()
    await expect(helixPage.getByRole('heading', { name: 'Codex Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute('aria-label', 'Usage analytics provider: Codex')

    await providerDropdown.click()
    await helixPage.getByRole('menuitem', { name: 'OpenCode', exact: true }).click()
    await expect(helixPage.getByRole('heading', { name: 'OpenCode Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: OpenCode'
    )
  })
})
