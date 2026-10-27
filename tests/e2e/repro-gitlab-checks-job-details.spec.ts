import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/helix-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { openChecks } from './helpers/source-control-ai-generation'

// expanding a GitLab job must render its synthetic trace instead of the no-inline-details fallback.
const FIXTURE = {
  mrNumber: 4242,
  jobId: 987654,
  jobName: 'Purchase API Component Tests',
  stage: 'Component Tests',
  webUrl: 'https://gitlab.example.test/acme/helix/-/jobs/987654',
  mrUrl: 'https://gitlab.example.test/acme/helix/-/merge_requests/4242',
  headSha: 'e2ee2ee2ee2ee2ee2ee2ee2ee2ee2ee2ee2ee2e',
  trace: [
    '$ pnpm test:component --project purchase-api',
    'FAIL  src/purchase/refund.spec.ts',
    '    AssertionError: expected refunded amount 4200 to equal 4250',
    'ERROR: Job failed: exit code 1'
  ].join('\n')
} as const

const SCREENSHOT_DIR =
  process.env.HELIX_GITLAB_CHECKS_JOB_DETAILS_SCREENSHOT_DIR ??
  path.join(process.cwd(), 'test-results', 'gitlab-checks-job-details')

// contextIsolation makes window.api non-writable, so stub at the IPC boundary in main.
async function installGitLabChecksBackend(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, fx) => {
    ipcMain.removeHandler('hostedReview:forBranch')
    ipcMain.handle('hostedReview:forBranch', async () => ({
      provider: 'gitlab',
      number: fx.mrNumber,
      title: 'Add purchase API component test coverage',
      state: 'open',
      url: fx.mrUrl,
      status: 'failure',
      updatedAt: '2026-07-07T12:00:00.000Z',
      mergeable: 'MERGEABLE',
      headSha: fx.headSha
    }))

    ipcMain.removeHandler('gitlab:workItemDetails')
    ipcMain.handle('gitlab:workItemDetails', async () => ({
      item: {
        id: `gitlab-mr-${fx.mrNumber}`,
        type: 'mr',
        number: fx.mrNumber,
        title: 'Add purchase API component test coverage',
        state: 'opened',
        url: fx.mrUrl,
        labels: [],
        updatedAt: '2026-07-07T12:00:00.000Z',
        author: 'e2e-bot'
      },
      body: 'Synthetic MR used for #7732 repro evidence.',
      comments: [],
      headSha: fx.headSha,
      pipelineJobs: [
        {
          id: fx.jobId,
          pipelineId: 55,
          name: fx.jobName,
          stage: fx.stage,
          status: 'failed',
          webUrl: fx.webUrl,
          duration: 87
        }
      ],
      reviewers: []
    }))

    ipcMain.removeHandler('gitlab:jobTrace')
    ;(globalThis as { __repro7732JobTraceCalls?: number }).__repro7732JobTraceCalls = 0
    ipcMain.handle('gitlab:jobTrace', async () => {
      const g = globalThis as { __repro7732JobTraceCalls?: number }
      g.__repro7732JobTraceCalls = (g.__repro7732JobTraceCalls ?? 0) + 1
      return { ok: true, trace: fx.trace }
    })
  }, FIXTURE)
}

async function readJobTraceCallCount(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(
    () => (globalThis as { __repro7732JobTraceCalls?: number }).__repro7732JobTraceCalls ?? 0
  )
}

async function linkGitLabMRToWorktree(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate(
    ({ worktreeId, mrNumber }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.setState((current) => ({
        worktreesByRepo: Object.fromEntries(
          Object.entries(current.worktreesByRepo).map(([repoId, worktrees]) => [
            repoId,
            worktrees.map((worktree) =>
              worktree.id === worktreeId ? { ...worktree, linkedGitLabMR: mrNumber } : worktree
            )
          ])
        ),
        gitStatusByWorktree: { ...current.gitStatusByWorktree, [worktreeId]: [] }
      }))
    },
    { worktreeId, mrNumber: FIXTURE.mrNumber }
  )
}

test.describe('GitLab Checks panel job details', () => {
  test('expanding a failed pipeline job shows its log, not "No inline details"', async ({
    helixPage,
    electronApp
  }) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
    await installGitLabChecksBackend(electronApp)

    const worktreeId = await helixPage.evaluate(
      () => window.__store?.getState().activeWorktreeId ?? null
    )
    if (!worktreeId) {
      throw new Error('E2E fixture did not expose an active worktree')
    }
    // Late startup UI hydration resets the active workspace + sidebar route; let it settle first.
    await helixPage.waitForTimeout(8_000)

    const jobRow = helixPage.getByText(`${FIXTURE.stage}: ${FIXTURE.jobName}`, { exact: true })
    for (let attempt = 0; attempt < 40 && (await jobRow.count()) === 0; attempt++) {
      await linkGitLabMRToWorktree(helixPage, worktreeId)
      await openChecks(helixPage, worktreeId)
      await helixPage.waitForTimeout(500)
    }
    await expect(jobRow).toBeVisible({ timeout: 15_000 })

    mkdirSync(SCREENSHOT_DIR, { recursive: true })
    await jobRow.click()
    const noDetails = helixPage.getByText('No inline details are available for this check.')
    const viewFullDetails = helixPage.getByRole('button', { name: 'View full details' })
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await noDetails.count()) > 0 || (await viewFullDetails.count()) > 0) {
        break
      }
      await helixPage.waitForTimeout(500)
    }
    await helixPage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'gitlab-checks-job-expanded.png')
    })

    expect(await readJobTraceCallCount(electronApp)).toBeGreaterThan(0)
    await expect(noDetails).toHaveCount(0)
    await expect(viewFullDetails).toBeVisible({ timeout: 10_000 })
  })
})
