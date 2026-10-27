// A fresh profile may have no automation history; Runs navigation and its empty state must still work.

import { test, expect } from './helpers/helix-app'
import { waitForSessionReady } from './helpers/store'

test('opens the runs dashboard and returns to automations', async ({ helixPage }) => {
  await waitForSessionReady(helixPage)

  await helixPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    store.getState().openAutomationsPage()
  })

  const runsButton = helixPage.getByRole('button', { name: 'Runs' })
  await expect(runsButton).toBeVisible()
  await runsButton.click()

  await expect(helixPage.getByRole('navigation', { name: 'Automations breadcrumb' })).toBeVisible()
  await expect(helixPage.getByText('Successful · 24h')).toBeVisible()
  await expect(helixPage.getByText('Failed · 24h')).toBeVisible()
  await expect(helixPage.getByText('Successful · 7d')).toBeVisible()
  await expect(helixPage.getByText('Failed · 7d')).toBeVisible()
  await expect(helixPage.getByRole('button', { name: 'Filters' })).toBeVisible()
  await expect(helixPage.getByRole('button', { name: 'Refresh runs' })).toBeVisible()
  await expect(helixPage.getByText('Automation', { exact: true })).toBeVisible()
  await expect(helixPage.getByText('Triggered', { exact: true })).toBeVisible()
  await expect(helixPage.getByText('Status', { exact: true })).toBeVisible()

  await helixPage
    .getByRole('navigation', { name: 'Automations breadcrumb' })
    .getByRole('button', { name: 'Automations' })
    .click()
  await expect(helixPage.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(runsButton).toBeVisible()
})
