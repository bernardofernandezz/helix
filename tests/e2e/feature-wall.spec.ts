import { test, expect } from './helpers/helix-app'
import { getStoreState, waitForSessionReady } from './helpers/store'
import type { ElectronApplication } from '@playwright/test'

async function openFeatureTourFromMenu(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const featureTourItem = Menu.getApplicationMenu()
      ?.items.find((item) => item.label === 'Help')
      ?.submenu?.items.find((item) => item.label === 'Explore Helix')

    if (!featureTourItem) {
      throw new Error('Explore Helix menu item was not registered')
    }

    const window = BrowserWindow.getAllWindows()[0]
    featureTourItem.click(featureTourItem, window, {
      triggeredByAccelerator: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false
    } as Electron.KeyboardEvent)
  })
}

test.describe('Feature tour modal', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
  })

  test('opens from the Help menu and renders the workflow rail', async ({
    electronApp,
    helixPage
  }) => {
    await openFeatureTourFromMenu(electronApp)

    await expect(helixPage.getByRole('dialog', { name: 'Get to know Helix' })).toBeVisible({
      timeout: 10_000
    })
    await expect(helixPage.getByText('Reopen any time from Help > Explore Helix.')).toBeVisible()

    const rail = helixPage.getByRole('navigation', { name: 'Workflows' })
    await expect(rail.getByRole('tab')).toHaveCount(5)
    await expect(rail.getByRole('tab', { name: /Workspaces/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await expect(helixPage.locator('[data-ws-id]')).toHaveCount(3)

    await rail.getByRole('tab', { name: /Workspaces/i }).focus()
    await helixPage.keyboard.press('ArrowDown')
    await expect(rail.getByRole('tab', { name: /Tasks/i })).toHaveAttribute('aria-selected', 'true')
    await helixPage.keyboard.press('ArrowDown')
    await expect(rail.getByRole('tab', { name: /Agents/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await rail.getByRole('tab', { name: /Workbench/i }).click()
    await rail.getByRole('button', { name: /Browser/i }).click()
    await expect(
      helixPage.getByText(
        "Run your app in Helix's browser, send selected UI elements to agents, and let your agents interact with your webpage."
      )
    ).toBeVisible()
    await expect(helixPage.getByRole('heading', { name: 'Browser Use skill' })).toBeVisible()
    await expect(
      helixPage.getByText("Enables agents to navigate and verify pages in Helix's browser.")
    ).toBeVisible()
    await expect(helixPage.getByRole('heading', { name: 'CLI skill' })).toHaveCount(0)
    await expect(helixPage.getByText('With the Helix CLI skill', { exact: false })).toHaveCount(0)
  })

  test('shows unified task copy without leaving the walkthrough', async ({ helixPage }) => {
    await helixPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.setState({
        preflightStatus: {
          git: { installed: true },
          gh: { installed: true, authenticated: false },
          glab: { installed: false, authenticated: false },
          bitbucket: { configured: false, authenticated: false, account: null },
          azureDevOps: {
            configured: false,
            authenticated: false,
            account: null,
            baseUrl: null,
            tokenConfigured: false
          },
          gitea: {
            configured: false,
            authenticated: false,
            account: null,
            baseUrl: null,
            tokenConfigured: false
          }
        },
        preflightStatusChecked: true,
        preflightStatusLoading: false,
        linearStatus: { connected: false, viewer: null },
        linearStatusChecked: true
      })
      store.getState().openModal('feature-wall', { source: 'help_menu' })
    })

    await expect(helixPage.getByRole('dialog', { name: 'Get to know Helix' })).toBeVisible({
      timeout: 10_000
    })
    await helixPage
      .getByRole('navigation', { name: 'Workflows' })
      .getByRole('tab', { name: /Tasks/i })
      .click()
    await expect(helixPage.getByText('Start work directly from GitHub or Linear.')).toBeVisible()
    await expect(helixPage.getByText('Connect GitHub or Linear once')).toHaveCount(0)
    await expect(helixPage.getByRole('dialog', { name: 'Get to know Helix' })).toBeVisible()
    await expect
      .poll(async () => getStoreState<string>(helixPage, 'activeView'))
      .not.toBe('settings')
  })

  test('continue advances through workflow substeps before the next workflow', async ({
    helixPage
  }) => {
    await helixPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().openModal('feature-wall', { source: 'help_menu' })
    })

    const rail = helixPage.getByRole('navigation', { name: 'Workflows' })
    const continueButton = helixPage.getByRole('button', { name: /^Continue/ })

    await continueButton.click()
    await expect(rail.getByRole('tab', { name: /Tasks/i })).toHaveAttribute('aria-selected', 'true')

    await continueButton.click()
    await expect(rail.getByRole('tab', { name: /Agents/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(rail.getByRole('button', { name: /Visibility/i })).toHaveAttribute(
      'aria-current',
      'step'
    )

    await continueButton.click()
    await expect(rail.getByRole('button', { name: /Orchestration/i })).toHaveAttribute(
      'aria-current',
      'step'
    )
    await expect(rail.getByRole('tab', { name: /Workbench/i })).toHaveAttribute(
      'aria-selected',
      'false'
    )

    await continueButton.click()
    await expect(rail.getByRole('button', { name: /Usage/i })).toHaveAttribute(
      'aria-current',
      'step'
    )

    await continueButton.click()
    await expect(rail.getByRole('tab', { name: /Workbench/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(rail.getByRole('button', { name: /Terminal/i })).toHaveAttribute(
      'aria-current',
      'step'
    )
  })

  test('does not pre-check configured workflows until the user visits them', async ({
    helixPage,
    electronApp
  }) => {
    await electronApp.evaluate(
      ({ ipcMain }, preflightStatus) => {
        ipcMain.removeHandler('preflight:check')
        ipcMain.handle('preflight:check', () => preflightStatus)
        ipcMain.removeHandler('linear:status')
        ipcMain.handle('linear:status', () => ({ connected: false, viewer: null }))
        ipcMain.removeHandler('jira:status')
        ipcMain.handle('jira:status', () => ({ connected: false, viewer: null }))
      },
      {
        git: { installed: true },
        gh: { installed: true, authenticated: true },
        glab: { installed: false, authenticated: false },
        bitbucket: { configured: false, authenticated: false, account: null },
        azureDevOps: {
          configured: false,
          authenticated: false,
          account: null,
          baseUrl: null,
          tokenConfigured: false
        },
        gitea: {
          configured: false,
          authenticated: false,
          account: null,
          baseUrl: null,
          tokenConfigured: false
        }
      }
    )
    await helixPage.evaluate(async () => {
      for (const key of [
        'helix.featureWall.visitedWorkflows.v1',
        'helix.featureWall.visitedAgentSteps.v1',
        'helix.featureWall.visitedWorkbenchSteps.v1',
        'helix.featureWall.visitedReviewSteps.v1',
        'helix.featureWall.completedWorkflows.v1',
        'helix.featureWall.completedAgentSteps.v1',
        'helix.featureWall.completedWorkbenchSteps.v1',
        'helix.featureWall.completedReviewSteps.v1'
      ]) {
        localStorage.removeItem(key)
      }
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      // Seed through the status actions so each result gets the current execution context.
      await Promise.all([
        store.getState().refreshPreflightStatus({ force: true }),
        store.getState().checkLinearConnection(true),
        store.getState().checkJiraConnection()
      ])
      store.getState().openModal('feature-wall', { source: 'help_menu' })
    })

    const rail = helixPage.getByRole('navigation', { name: 'Workflows' })
    const workspacesTab = rail.locator('[data-feature-wall-workflow-id="workspaces"]')
    const tasksTab = rail.locator('[data-feature-wall-workflow-id="tasks"]')
    await expect(workspacesTab.locator('[aria-label="Completed"]')).toHaveCount(1)
    await expect(tasksTab.locator('[aria-label="Completed"]')).toHaveCount(0)
    await tasksTab.click()
    await expect(tasksTab.locator('[aria-label="Completed"]')).toHaveCount(1)
    await expect(workspacesTab.locator('[aria-label="Completed"]')).toHaveCount(1)
  })

  test('keeps persisted completed setup-backed substeps checked when reopened', async ({
    helixPage
  }) => {
    await helixPage.evaluate(() => {
      localStorage.setItem(
        'helix.featureWall.completedAgentSteps.v1',
        JSON.stringify(['orchestration'])
      )
      localStorage.setItem(
        'helix.featureWall.completedWorkbenchSteps.v1',
        JSON.stringify(['browser'])
      )
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().openModal('feature-wall', { source: 'help_menu' })
    })

    const rail = helixPage.getByRole('navigation', { name: 'Workflows' })

    await rail.getByRole('tab', { name: /Agents/i }).click()
    await expect(
      rail.getByRole('button', { name: /Orchestration/i }).locator('[aria-label="Completed"]')
    ).toHaveCount(1)

    await rail.getByRole('tab', { name: /Workbench/i }).click()
    await expect(
      rail.getByRole('button', { name: /Browser/i }).locator('[aria-label="Completed"]')
    ).toHaveCount(1)
  })
})
