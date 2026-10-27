// Offer "Move anyway" only when a consent-free preview shows it clears the blockers.
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { collectHelixdMigrationUntransferredDependencyCensus } from './helixd-source-dependency-census'
import { collectHelixdMigrationSourceDormantState } from './helixd-source-dormant-state'
import type { HelixdMigrationDeltaView } from './helixd-source-delta-view'

export function createHelixdMigrationLeaveBehindView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  targetId: string
): HelixdMigrationDeltaView {
  // Read-only collectors make a shallow copy sufficient.
  const state = {
    ...runtime.state,
    sshTargets: runtime.state.sshTargets.map((target) =>
      target.id === targetId
        ? { ...target, managedServerLeaveBehind: { confirmedAt: new Date(0).toISOString() } }
        : target
    )
  }
  const storage = runtime.terminalScrollbackSnapshotStorage
  return {
    getRepos: () => state.repos,
    getFolderWorkspaces: () => state.folderWorkspaces,
    getProjectGroups: () => state.projectGroups,
    collectHelixdMigrationSourceDormantState: (source, catalog, destinationEnvironmentId) =>
      collectHelixdMigrationSourceDormantState(
        state,
        source,
        catalog,
        storage,
        destinationEnvironmentId
      ).payload,
    inspectHelixdMigrationUntransferredDependencies: (manifest) =>
      collectHelixdMigrationUntransferredDependencyCensus(state, manifest, storage)
  }
}
