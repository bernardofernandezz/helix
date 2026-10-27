// Export only additions from older builds by subtracting prior migrations from a profile copy.
import type {
  HelixdMigrationCatalogPayload,
  HelixdMigrationDormantStatePayload,
  HelixdMigrationManifest,
  HelixdMigrationManifestSource
} from '../../../shared/helixd-migration/helixd-migration-manifest'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { subtractHelixdSourceCatalogState } from './helixd-source-catalog-subtraction'
import {
  collectHelixdMigrationUntransferredDependencyCensus,
  type HelixdMigrationSourceDependencyCensus
} from './helixd-source-dependency-census'
import { subtractHelixdMigrationSourceDormantState } from './helixd-source-dormant-subtraction'
import { collectHelixdMigrationSourceDormantState } from './helixd-source-dormant-state'
import { subtractHelixdMigrationScopeWorkspaceSession } from './helixd-source-workspace-session-subtraction'

export type HelixdMigrationDeltaView = {
  getRepos: () => Repo[]
  getFolderWorkspaces: () => FolderWorkspace[]
  getProjectGroups: () => ProjectGroup[]
  collectHelixdMigrationSourceDormantState: (
    source: HelixdMigrationManifestSource,
    catalog: HelixdMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ) => HelixdMigrationDormantStatePayload
  inspectHelixdMigrationUntransferredDependencies: (
    manifest: HelixdMigrationManifest
  ) => HelixdMigrationSourceDependencyCensus
}

/** moved includes today's edits to previously migrated rows. */
export function createHelixdMigrationDeltaView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  moved: HelixdMigrationManifest
): HelixdMigrationDeltaView {
  const state = structuredClone(runtime.state)
  subtractHelixdSourceCatalogState(state, moved)
  subtractHelixdMigrationSourceDormantState(state, moved)
  // The server owns the moved projects' tabs now, even ones the older build left unmovable.
  subtractHelixdMigrationScopeWorkspaceSession(state, moved)
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
