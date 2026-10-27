/** IPC for a host an older build changed after conversion: move its newer projects, or keep the server's. */
import { ipcMain } from 'electron'
import type {
  HelixdDeltaMovePreview,
  HelixdDeltaMoveResult
} from '../../../shared/helixd-managed-runtime'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { requireManagedHelixdInfrastructure } from '../../managed-server/lifecycle/helixd-managed-runtime-context'
import { ensureHelixdManagedTunnel } from '../../managed-server/lifecycle/helixd-managed-tunnel'
import { keepHelixdServerVersion, runHelixdDeltaMove } from '../../ssh/helixd-migration-delta-move'
import { planHelixdDeltaMove } from '../../ssh/helixd-migration-delta-plan'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { helixdMigrationDestinationFor } from '../../managed-server/lifecycle/helixd-runtime-conversion-wiring'
import { requiredString } from './helixd-runtime-lifecycle-handlers'
import { publishResolvedChangedHostStatus } from './runtime-environment-managed-tunnel'
import { runTargetLifecycle } from '../ssh/ssh-target-lifecycle-queue'

export function registerHelixdDeltaMoveHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:previewHelixdDeltaMove',
    (_event, args: { sshTargetId: string }): HelixdDeltaMovePreview => {
      const { store, target } = requireChangedHost(args)
      const plan = planHelixdDeltaMove(getUserDataPath(), store, target)
      const { sshTargetId, environmentId, added, notReflected, blockers } = plan
      return { sshTargetId, environmentId, added, notReflected, blockers }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:moveHelixdDelta',
    async (_event, args: { sshTargetId: string }): Promise<HelixdDeltaMoveResult> => {
      const userDataPath = getUserDataPath()
      const { store, claims, target } = requireChangedHost(args)
      const environment = listEnvironments(userDataPath).find(
        (entry) => entry.id === target.helixdFence?.environmentId
      )
      if (!environment) {
        throw new Error('This host’s Helix server is no longer registered.')
      }
      const result = await runHelixdDeltaMove({
        userDataPath,
        store,
        claims,
        target,
        environment,
        connectDestination: async () =>
          helixdMigrationDestinationFor(
            await ensureHelixdManagedTunnel(userDataPath, environment.id)
          ),
        censusHost: censusHostRelayTerminalsFor(target),
        runTargetLifecycle
      })
      if (result.outcome === 'moved') {
        publishResolvedChangedHostStatus(target, environment.id)
      }
      return result
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:keepHelixdServerVersion',
    async (_event, args: { sshTargetId: string }): Promise<void> => {
      const { store, claims, target, environmentId } = requireChangedHost(args)
      await runTargetLifecycle(target.id, () =>
        keepHelixdServerVersion({ userDataPath: getUserDataPath(), store, claims, target })
      )
      publishResolvedChangedHostStatus(target, environmentId)
    }
  )
}

function requireChangedHost(args: { sshTargetId: string } | undefined) {
  const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
  const { targetStore, claims } = requireManagedHelixdInfrastructure()
  const store = targetStore.getHelixdMigrationSource()
  const target = store.getSshTarget(sshTargetId)
  if (!target?.helixdFence?.sourceChangedAt) {
    throw new Error('This SSH host has no changes from an older Helix to resolve.')
  }
  return { store, claims, target, environmentId: target.helixdFence.environmentId }
}
