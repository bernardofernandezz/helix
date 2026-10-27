import type { FolderWorkspace } from '../folder-workspace-types'
import type { Automation, AutomationRun } from '../automations-types'
import type { HelixdMigrationManifestVersion } from './helixd-migration-manifest-validation'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import type { SparsePreset } from '../worktree/create-types'
import type { WorkspaceLineage, WorktreeLineage } from '../worktree/lineage-types'
import type { WorktreeMeta } from '../worktree/meta-types'
import type { RetiredNameRegistry } from '../worktree/retired-name-registry'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import type { HelixdMigrationClientStatePayload } from './helixd-migration-client-state'
import type {
  HelixdMigrationSnapshotUploadState,
  HelixdMigrationTerminalScrollbackSnapshot
} from './helixd-migration-scrollback'
import type { HelixdMigrationBlobUploadState } from './helixd-migration-blob-transfer'

import { isRecord } from './helixd-migration-manifest-fields'

/** The relay-era SSH source: on the wire it never carries `kind` (see helixd-migration-source-kind). */
export type HelixdMigrationSshManifestSource = {
  sshTargetId: string
  sshTargetGeneration: number | null
  targetLabel: string
}

/** Explicit desktop WSL project scope prevents destination path inference; generation orders delta moves. */
export type HelixdMigrationLocalWslManifestSource = {
  kind: 'local-wsl'
  distro: string
  /** The distro's registry id, when known: a re-registered distro of the same name is another one. */
  distroGuid?: string
  scopeRepoIds: string[]
  scopeFolderWorkspaceIds: string[]
  generation: number
}

export type HelixdMigrationManifestSource =
  | HelixdMigrationSshManifestSource
  | HelixdMigrationLocalWslManifestSource

export type HelixdMigrationCatalogPayload = {
  repositories: Repo[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  dormantState?: HelixdMigrationDormantStatePayload
}

export type HelixdMigrationDormantWorktreeMeta = {
  sourceKey: string
  worktreeId: string
  meta: WorktreeMeta
}

export type HelixdMigrationDormantWorktreeLineage = {
  sourceKey: string
  worktreeId: string
  lineage: WorktreeLineage
}

export type HelixdMigrationDormantWorkspaceLineage = {
  sourceKey: string
  childWorkspaceKey: string
  lineage: WorkspaceLineage
}

export type HelixdMigrationDormantRetiredNames = {
  repoId: string
  registry: RetiredNameRegistry
}

export type HelixdMigrationDormantRetirementNamespace = {
  sourceNamespaceKeys: string[]
  namespaceKey: string
  registry: RetiredNameRegistry
}

export type HelixdMigrationDormantStatePayload = {
  version: 1
  worktreeMeta: HelixdMigrationDormantWorktreeMeta[]
  worktreeLineage: HelixdMigrationDormantWorktreeLineage[]
  workspaceLineage: HelixdMigrationDormantWorkspaceLineage[]
  sparsePresets: SparsePreset[]
  retiredWorktreeNames: HelixdMigrationDormantRetiredNames[]
  retiredWorktreeNamespaces: HelixdMigrationDormantRetirementNamespace[]
  workspaceSession?: WorkspaceSessionState
  terminalScrollbackSnapshots?: HelixdMigrationTerminalScrollbackSnapshot[]
  automations?: Automation[]
  automationRuns?: AutomationRun[]
  /** Client-owned durable intent projected to the destination authority. */
  clientState?: HelixdMigrationClientStatePayload
}

export type HelixdMigrationManifest = {
  version: HelixdMigrationManifestVersion
  migrationId: string
  createdAt: string
  source: HelixdMigrationManifestSource
  payload: HelixdMigrationCatalogPayload
  /** Destination runtime identity used to re-key desktop routing after commit. */
  destinationEnvironmentId?: string
  manifestSha256: string
}

export type HelixdMigrationImportReceipt = {
  version: HelixdMigrationManifestVersion
  migrationId: string
  manifestSha256: string
  source: HelixdMigrationManifestSource
  importedAt: string
  repositoryIds: string[]
  projectGroupIds: string[]
  folderWorkspaceIds: string[]
}

export type HelixdMigrationStagedCatalog = {
  version: HelixdMigrationManifestVersion
  manifest: HelixdMigrationManifest
  stagedAt: string
}

export type HelixdMigrationCatalogState =
  | {
      state: 'absent'
      migrationId: string
      manifestSha256: string
    }
  | {
      state: 'staged'
      migrationId: string
      manifestSha256: string
      stagedAt: string
      snapshotUploads?: HelixdMigrationSnapshotUploadState[]
      /** Blobs staged so far; absent from hosts without the blob channel. */
      blobUploads?: HelixdMigrationBlobUploadState[]
    }
  | {
      state: 'committed'
      migrationId: string
      manifestSha256: string
      receipt: HelixdMigrationImportReceipt
    }

export type HelixdMigrationCatalogAbortResult = HelixdMigrationCatalogState & {
  aborted: boolean
  durableAbsent?: true
}

export type HelixdMigrationCatalogReference = Pick<
  HelixdMigrationManifest,
  'migrationId' | 'manifestSha256'
>

/** An abort by reference: no receipt, since an evicted one is rebuilt only from the manifest. */
export type HelixdMigrationCatalogReferenceAbortResult = HelixdMigrationCatalogReference & {
  state: 'absent' | 'committed'
  aborted: boolean
  durableAbsent?: true
}

export function helixdMigrationManifestHashInput(
  manifest: Omit<HelixdMigrationManifest, 'manifestSha256'>
): string {
  return serializeHelixdMigrationValue(manifest)
}

export function serializeHelixdMigrationValue(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value))
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)])
  )
}
