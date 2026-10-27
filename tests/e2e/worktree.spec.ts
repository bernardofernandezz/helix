import { openSidebarWorkspaceComposer } from './helpers/sidebar-project-dialog'
// Drive the real Create Workspace composer: old direct store creation missed ’s React #31 render crash ’s modal replacement.
//  removed StartFromField, but console/pageerror checks still reject equivalent render crashes; see tests/e2e/AGENTS.md.

import type { ConsoleMessage } from '@playwright/test'
import { test, expect } from './helpers/helix-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  ensureTerminalVisible,
  worktreeExists
} from './helpers/store'

test.describe('Create Workspace', () => {
  test.beforeEach(async ({ helixPage }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
  })

  test('creates a worktree through the composer UI and activates it', async ({ helixPage }) => {
    const worktreeIdBefore = await getActiveWorktreeId(helixPage)

    // Capture both console’s invalid-React-child message and pageerror #31 for dev/production render failures.
    const pageErrors: Error[] = []
    helixPage.on('pageerror', (err) => {
      pageErrors.push(err)
    })
    const consoleErrors: string[] = []
    const onConsole = (msg: ConsoleMessage): void => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    }
    helixPage.on('console', onConsole)

    const workspaceName = `e2e-create-${Date.now()}`

    try {
      // Open via visible affordance to cover lazy modal mount.
      await openSidebarWorkspaceComposer(helixPage)

      const dialog = helixPage.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
      await expect(dialog).toBeVisible()

      // Wait for agent probe/name focus/hydration/setup hooks before clicking through Radix FocusScope reparenting.
      await expect(dialog.locator('[data-workspace-name-input="true"]')).toBeVisible()

      // Round-trip getBaseRefDefault so envelope consumers can trigger -class render errors removed StartFromField.
      await helixPage.evaluate(async () => {
        const repoId = Object.values(window.__store!.getState().worktreesByRepo).flat()[0]?.repoId
        if (!repoId) {
          return
        }
        await window.api.repos.getBaseRefDefault({ repoId })
      })
      await helixPage.waitForTimeout(100)

      // Plain text in default smart mode submits as workspace name.
      const nameInput = dialog.getByPlaceholder(/Type a name/i)
      await expect(nameInput).toBeVisible()
      await nameInput.fill(workspaceName)

      const createButton = dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i })
      await expect(createButton).toBeEnabled()
      await createButton.click()

      await expect(dialog).toBeHidden({ timeout: 15_000 })

      await expect
        .poll(async () => worktreeExists(helixPage, workspaceName), {
          timeout: 10_000,
          message: `Worktree "${workspaceName}" did not appear in the store`
        })
        .toBe(true)

      await expect
        .poll(
          async () => {
            const id = await getActiveWorktreeId(helixPage)
            return id !== null && id !== worktreeIdBefore
          },
          { timeout: 10_000, message: 'New worktree did not become the active worktree' }
        )
        .toBe(true)

      // Require auto-created terminal to prove activateAndRevealWorktree ran beyond creating the store row.
      await ensureTerminalVisible(helixPage)

      expect(pageErrors, `pageerror fired: ${pageErrors.map((e) => e.message).join(', ')}`).toEqual(
        []
      )
      const reactChildErrors = consoleErrors.filter((text) =>
        /Objects are not valid as a React child|Minified React error #31/i.test(text)
      )
      expect(reactChildErrors, `React render error: ${reactChildErrors.join(', ')}`).toEqual([])
    } finally {
      helixPage.off('console', onConsole)
      // Best-effort close if the test failed mid-flow and left the modal open.
      await helixPage
        .evaluate(() => {
          window.__store?.getState().closeModal()
        })
        .catch(() => {
          /* page may already be torn down */
        })
    }
  })

  test('creates an emoji-named worktree with a safe git branch', async ({ helixPage }) => {
    const workspaceName = '🚀🧪✨'

    try {
      await openSidebarWorkspaceComposer(helixPage)

      const dialog = helixPage.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('[data-workspace-name-input="true"]')).toBeVisible()

      const nameInput = dialog.getByPlaceholder(/Type a name/i)
      await nameInput.fill(workspaceName)

      const createButton = dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i })
      await expect(createButton).toBeEnabled()
      await createButton.click()

      await expect(dialog).toBeHidden({ timeout: 15_000 })
      await expect(helixPage.getByRole('option', { name: new RegExp(workspaceName) })).toBeVisible({
        timeout: 10_000
      })

      const branch = await helixPage.evaluate((displayName) => {
        const worktrees = Object.values(window.__store!.getState().worktreesByRepo).flat()
        return worktrees.find((worktree) => worktree.displayName === displayName)?.branch ?? null
      }, workspaceName)
      expect(branch).toBe('refs/heads/rocket-test-tube-sparkles')
    } finally {
      await helixPage
        .evaluate(() => {
          window.__store?.getState().closeModal()
        })
        .catch(() => {
          /* page may already be torn down */
        })
    }
  })

  test('enters the Korean flag with the flag_kr shortcode suggestion', async ({ helixPage }) => {
    try {
      await openSidebarWorkspaceComposer(helixPage)

      const dialog = helixPage.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
      const nameInput = dialog.getByPlaceholder(/Type a name/i)
      await expect(nameInput).toBeVisible()

      await nameInput.pressSequentially('Launch :flag_kr', { delay: 100 })
      const emojiSuggestions = helixPage.locator('[data-workspace-emoji-suggestions="true"]')
      const sourceSuggestions = helixPage.locator('[data-workspace-source-suggestions="true"]')
      await expect(emojiSuggestions).toBeVisible()
      await expect(emojiSuggestions.getByRole('option', { name: ':flag_kr:' })).toBeVisible()
      await expect(emojiSuggestions).toHaveAttribute('data-side', 'top')
      await expect(sourceSuggestions).toBeVisible()
      await expect(sourceSuggestions).toHaveAttribute('data-side', 'bottom')
      // Keep both independently positioned suggestion surfaces visible in proof recordings.
      await helixPage.waitForTimeout(750)

      await nameInput.pressSequentially(':')
      await expect(nameInput).toHaveValue('Launch 🇰🇷')
      await expect(helixPage.getByRole('option', { name: /:flag_kr:/i })).toHaveCount(0)
      await nameInput.pressSequentially(' experiment')
      await expect(nameInput).toHaveValue('Launch 🇰🇷 experiment')
      // Keep the asserted result visible in retained proof recordings.
      await helixPage.waitForTimeout(750)
    } finally {
      await helixPage
        .evaluate(() => {
          window.__store?.getState().closeModal()
        })
        .catch(() => {
          /* page may already be torn down */
        })
    }
  })

  test('shows a failed workspace entry when worktree creation fails', async ({ helixPage }) => {
    await helixPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const originalCreateWorktree = store.getState().createWorktree
      ;(
        window as unknown as {
          __restoreCreateWorktree?: () => void
        }
      ).__restoreCreateWorktree = () => {
        store.setState({ createWorktree: originalCreateWorktree })
      }
      store.setState({
        createWorktree: async () => {
          throw new Error('could not resolve a default base ref for the E2E fixture')
        }
      })
    })

    try {
      const workspaceName = `e2e-create-failure-${Date.now()}`

      await openSidebarWorkspaceComposer(helixPage)

      const dialog = helixPage.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('[data-workspace-name-input="true"]')).toBeVisible()

      const nameInput = dialog.getByPlaceholder(/Type a name/i)
      await expect(nameInput).toBeVisible()
      await nameInput.fill(workspaceName)

      const createButton = dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i })
      await expect(createButton).toBeEnabled()
      await createButton.click()

      await expect(dialog).toBeHidden()
      const failedWorkspace = helixPage.getByRole('button', {
        name: new RegExp(`${workspaceName} No base branch found`)
      })
      await expect(failedWorkspace).toBeVisible()
      await expect(helixPage.getByText('Couldn’t create worktree')).toBeVisible()
      await expect(failedWorkspace).toContainText('No base branch found')
      await expect(helixPage.getByRole('button', { name: 'Retry' })).toBeVisible()
    } finally {
      await helixPage
        .evaluate(() => {
          ;(
            window as unknown as {
              __restoreCreateWorktree?: () => void
            }
          ).__restoreCreateWorktree?.()
          window.__store?.getState().closeModal()
        })
        .catch(() => {
          /* page may already be torn down */
        })
    }
  })

  test('reuses a resolved pasted GitHub URL when quick create submits', async ({
    electronApp,
    helixPage
  }) => {
    const title = `E2E smart URL resolution ${Date.now()}`
    const url = 'https://github.com/bernardofernandezz/helix/pull/2049'
    const linkedWorkspacePattern = new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

    try {
      await openSidebarWorkspaceComposer(helixPage)

      const dialog = helixPage.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('[data-workspace-name-input="true"]')).toBeVisible()

      await electronApp.evaluate(
        ({ ipcMain }, { title, url }) => {
          const counters = globalThis as unknown as {
            __smartGitHubLookupCount: number
            __smartResolvePrBaseCount: number
          }
          counters.__smartGitHubLookupCount = 0
          counters.__smartResolvePrBaseCount = 0
          ipcMain.removeHandler('gh:workItemByOwnerRepo')
          ipcMain.handle(
            'gh:workItemByOwnerRepo',
            (
              _event: unknown,
              args: {
                number: number
                repoId?: string
              }
            ) => {
              counters.__smartGitHubLookupCount += 1
              return {
                id: `e2e-pr-${args.number}`,
                type: 'pr',
                number: args.number,
                title,
                state: 'open',
                url,
                labels: [],
                updatedAt: '2026-05-26T00:00:00.000Z',
                author: 'e2e',
                repoId: args.repoId ?? 'e2e-repo'
              }
            }
          )
          ipcMain.removeHandler('worktrees:resolvePrBase')
          // Use HEAD: the remote-less fixture’s default branch depends on host init.defaultBranch.
          ipcMain.handle('worktrees:resolvePrBase', () => {
            counters.__smartResolvePrBaseCount += 1
            return { baseBranch: 'HEAD' }
          })
        },
        { title, url }
      )

      const nameInput = dialog.getByPlaceholder(/Type a name/i)
      await expect(nameInput).toBeVisible()
      await nameInput.fill(url)

      await expect
        .poll(() =>
          electronApp.evaluate(() => {
            const counters = globalThis as unknown as {
              __smartGitHubLookupCount?: number
              __smartResolvePrBaseCount?: number
            }
            return {
              githubLookupCount: counters.__smartGitHubLookupCount ?? -1,
              resolvePrBaseCount: counters.__smartResolvePrBaseCount ?? -1
            }
          })
        )
        .toEqual({ githubLookupCount: 1, resolvePrBaseCount: 0 })
      const createButton = dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i })
      await expect(createButton).toBeEnabled()
      await createButton.click()

      await expect(dialog).toBeHidden({ timeout: 15_000 })
      await expect(helixPage.getByRole('option', { name: linkedWorkspacePattern })).toBeVisible({
        timeout: 10_000
      })
      await expect(helixPage.getByRole('option', { name: url })).toHaveCount(0)
      await expect(helixPage.getByText('Linked PR #2049')).toBeVisible()
      // Quick create reuses typing’s GitHub lookup; resolves PR head once at submit, requiring one base resolution.
      await expect
        .poll(() =>
          electronApp.evaluate(() => {
            const counters = globalThis as unknown as {
              __smartGitHubLookupCount?: number
              __smartResolvePrBaseCount?: number
            }
            return {
              githubLookupCount: counters.__smartGitHubLookupCount ?? -1,
              resolvePrBaseCount: counters.__smartResolvePrBaseCount ?? -1
            }
          })
        )
        .toEqual({ githubLookupCount: 1, resolvePrBaseCount: 1 })
    } finally {
      await helixPage
        .evaluate(() => {
          window.__store?.getState().closeModal()
        })
        .catch(() => {
          /* page may already be torn down */
        })
    }
  })

  test('names the workspace after the PR title when the pasted URL suggestion is selected', async ({
    electronApp,
    helixPage
  }) => {
    const title = `E2E selected URL resolution ${Date.now()}`
    const url = 'https://github.com/bernardofernandezz/helix/pull/2050'
    const linkedWorkspacePattern = new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

    try {
      await openSidebarWorkspaceComposer(helixPage)

      const dialog = helixPage.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('[data-workspace-name-input="true"]')).toBeVisible()

      await electronApp.evaluate(
        ({ ipcMain }, { title, url }) => {
          ipcMain.removeHandler('gh:workItemByOwnerRepo')
          ipcMain.handle(
            'gh:workItemByOwnerRepo',
            (_event: unknown, args: { number: number; repoId?: string }) => ({
              id: `e2e-pr-${args.number}`,
              type: 'pr',
              number: args.number,
              title,
              state: 'open',
              url,
              labels: [],
              updatedAt: '2026-05-26T00:00:00.000Z',
              author: 'e2e',
              repoId: args.repoId ?? 'e2e-repo'
            })
          )
          ipcMain.removeHandler('worktrees:resolvePrBase')
          // Use HEAD: the remote-less fixture’s default branch depends on host init.defaultBranch.
          ipcMain.handle('worktrees:resolvePrBase', () => ({ baseBranch: 'HEAD' }))
        },
        { title, url }
      )

      const nameInput = dialog.getByPlaceholder(/Type a name/i)
      await expect(nameInput).toBeVisible()
      await nameInput.fill(url)

      // selecting resolved suggestion must replace the pasted URL as name; locate its portaled row outside the dialog.
      const suggestion = helixPage.getByRole('option', { name: linkedWorkspacePattern })
      await expect(suggestion).toBeVisible()
      await helixPage.keyboard.press('Enter')

      const createButton = dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i })
      await expect(createButton).toBeEnabled()
      await createButton.click()

      await expect(dialog).toBeHidden({ timeout: 15_000 })
      await expect(helixPage.getByRole('option', { name: linkedWorkspacePattern })).toBeVisible({
        timeout: 10_000
      })
      await expect(helixPage.getByRole('option', { name: /https-github/i })).toHaveCount(0)
      await expect(helixPage.getByText('Linked PR #2050')).toBeVisible()
    } finally {
      await helixPage
        .evaluate(() => {
          window.__store?.getState().closeModal()
        })
        .catch(() => {
          /* page may already be torn down */
        })
    }
  })
})
