import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './helpers/helix-app'
import { waitForSessionReady } from './helpers/store'
import { createRestartSession } from './helpers/helix-restart'
import { convertAndRetain, managedServer } from './helpers/helixd-convert-flow'
import { seedRelayEraProfile } from './helpers/helixd-upgrade-profile'
import { seedRetainedUpgradeState } from './helpers/helixd-upgrade-retained-state'
import { readPersistedProfileState } from './helpers/persisted-profile-state'
import { startHelixdConvertHost } from './helpers/helixd-convert-host'
import { toSshExecutionHostId } from '../../src/shared/execution-host'

const HOST = process.env.HELIX_E2E_HELIXD_CONVERT_HOST
const TEMPLATE = process.env.HELIX_E2E_HELIXD_CONVERT_TEMPLATE
test.skip(
  !HOST || !TEMPLATE,
  'Set HELIX_E2E_HELIXD_CONVERT_HOST and HELIX_E2E_HELIXD_CONVERT_TEMPLATE'
)

test('cross-host history, closed-pane resumes and stale local snapshots survive an SSH upgrade', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(15 * 60_000)
  const host = startHelixdConvertHost(HOST!, testInfo)
  const session = createRestartSession(testInfo, { HELIX_HELIXD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await first.page.evaluate((path) => window.api.repos.add({ path }), testRepoPath)
    await session.close(app)
    app = null
    const seeded = seedRelayEraProfile(
      session.userDataDir,
      host.input,
      {
        repoPath: host.remoteRepoPath,
        folderPath: host.remoteFolderPath
      },
      { terminalTab: true }
    )
    seedRetainedUpgradeState(session.userDataDir, seeded, testRepoPath)
    const upgraded = await session.launch()
    app = upgraded.app
    await waitForSessionReady(upgraded.page)
    await upgraded.page.evaluate(
      ({ worktreeId, hostId, tabId }) => {
        const state = window.__store!.getState()
        state.setActiveWorktree(worktreeId, hostId)
        state.setActiveTab(tabId)
        state.setActiveTabType('terminal', worktreeId)
      },
      {
        worktreeId: seeded.worktreeId,
        hostId: toSshExecutionHostId(seeded.targetId),
        tabId: seeded.terminalTabId!
      }
    )
    await expect
      .poll(() => managedServer(upgraded.page, seeded.targetId), { timeout: 8 * 60_000 })
      .toMatchObject({ kind: 'managed' })
    await convertAndRetain(upgraded.page, session.userDataDir, seeded)
    await expect(upgraded.page.getByText('helixd upgrade folder', { exact: true })).toBeVisible()
    await upgraded.page.screenshot({ path: testInfo.outputPath('managed-ssh-upgrade.png') })
    const retained = readPersistedProfileState(session.userDataDir)
    expect(retained.worktreeLineageById).toHaveProperty(seeded.worktreeId)
    expect(retained.workspaceSessionsByHostId).toHaveProperty(
      `${toSshExecutionHostId(seeded.targetId)}.sleepingAgentSessionsByPaneKey.closed-agent-tab:closed-leaf`
    )
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    host.cleanup()
  }
})
