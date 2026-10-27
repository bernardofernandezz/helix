/** Registered destinations must abort/prove empty, then unregister before fence release so later starts cannot reclaim the host. Never-registered destinations held nothing. */
import { removeManagedHelixdEnvironment } from '../../shared/runtime-environment-managed-helixd-store'
import { listEnvironments } from '../../shared/runtime-environment-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { closeHelixdManagedTunnel } from '../managed-server/lifecycle/helixd-managed-tunnel'
import {
  abortHelixdMigrationCutover,
  type HelixdMigrationAbortResult,
  type HelixdMigrationCutoverContext,
  type HelixdMigrationDestinationCatalog
} from './helixd-migration-cutover-coordinator'
import { findHelixdMigrationSourceCutoverForTarget } from './helixd-migration-cutover-journal'
import {
  releaseHelixdMigrationFence,
  releaseUndeployedMigrationFence
} from './helixd-migration-source-fence'

export async function abandonHelixdConversion(args: {
  userDataPath: string
  store: HelixdMigrationCutoverContext['store']
  claims: HelixdMigrationCutoverContext['claims']
  targetId: string
  destinationFor: (environment: KnownRuntimeEnvironment) => HelixdMigrationDestinationCatalog
}): Promise<HelixdMigrationAbortResult | 'none'> {
  const cutover = findHelixdMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Committed delta chains resolve only through the delta flow.
  if (!cutover || cutover.supersedesMigrationId) {
    return 'none'
  }
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  const environment = listEnvironments(args.userDataPath).find(
    (entry) => entry.id === cutover.destinationEnvironmentId
  )
  if (!environment) {
    await releaseUndeployedMigrationFence({ ...args, isDestinationRegistered: isRegistered })
    return 'none'
  }
  const context = { ...args, destination: args.destinationFor(environment) }
  return abortHelixdMigrationCutover(context, cutover.migrationId, async (aborted) => {
    await closeHelixdManagedTunnel(environment.id).catch(() => undefined)
    removeManagedHelixdEnvironment(args.userDataPath, environment.id)
    await releaseHelixdMigrationFence(context, aborted)
  })
}
