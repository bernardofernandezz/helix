import { MAX_HELIXD_MIGRATION_STAGED_CATALOGS } from '../../../shared/helixd-migration/helixd-migration-staged-catalog-validation'
import { HELIXD_MIGRATION_MANIFEST_VERSION } from '../../../shared/helixd-migration/helixd-migration-manifest-validation'
import type {
  HelixdMigrationCatalogAbortResult,
  HelixdMigrationCatalogReference,
  HelixdMigrationCatalogReferenceAbortResult,
  HelixdMigrationCatalogState,
  HelixdMigrationImportReceipt,
  HelixdMigrationManifest
} from '../../../shared/helixd-migration/helixd-migration-manifest'
import type {
  HelixdMigrationSnapshotChunkRequest,
  HelixdMigrationSnapshotChunkResult
} from '../../../shared/helixd-migration/helixd-migration-scrollback'
import type {
  HelixdMigrationBlobChunkRequest,
  HelixdMigrationBlobChunkResult,
  HelixdMigrationBlobDescriptor
} from '../../../shared/helixd-migration/helixd-migration-blob-transfer'
import type { RepoLifecycleOperations } from '../loading-store/repo-lifecycle-operations'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import type { WriteSchedulingOperations } from '../loading-store/write-scheduling'
import { scheduleSave } from '../loading-store/write-scheduling'
import {
  applyPreparedHelixdMigrationCatalog,
  assertHelixdMigrationReceiptMatchesManifest,
  assertSameHelixdMigrationManifest,
  prepareHelixdMigrationCatalog,
  type PreparedHelixdMigrationCatalog
} from './helixd-catalog-records'
import {
  expireHelixdMigrationStages,
  findHelixdMigrationImportReceipt,
  isLiveHelixdMigrationStage,
  recordHelixdMigrationCommitWriteGeneration,
  recordHelixdMigrationImportReceipt,
  type HelixdMigrationCommitGenerationRuntime
} from './helixd-catalog-receipt-ledger'
import {
  abortHelixdMigrationSnapshots,
  assertHelixdMigrationSnapshotsReady,
  commitHelixdMigrationSnapshots,
  inspectHelixdMigrationSnapshotUploads,
  pruneHelixdMigrationSnapshotStaging,
  stageHelixdMigrationSnapshotChunk
} from './helixd-scrollback-snapshot-transfer'
import {
  abortHelixdMigrationBlobs,
  assertHelixdMigrationBlobSetMatches,
  assertHelixdMigrationBlobsReady,
  commitHelixdMigrationBlobs,
  inspectHelixdMigrationBlobUploads,
  pruneHelixdMigrationBlobStaging,
  stageHelixdMigrationBlobChunk
} from './helixd-migration-blob-staging'
import { assertHelixdMigrationBlobContentsValid } from './helixd-migration-blob-installers'
import {
  abortHelixdMigrationCatalogByReference,
  committedMigrations,
  stagedManifests
} from './helixd-catalog-reference-abort'

type HelixdCatalogImportRuntime = HelixdMigrationCommitGenerationRuntime &
  Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage' | 'helixdMigrationBlobRoot'>

const helixdCatalogImportContext = Symbol('HelixdCatalogImportPersistence')
type HelixdCatalogImportContext = {
  runtime: HelixdCatalogImportRuntime
  repos: RepoLifecycleOperations
  scheduling: WriteSchedulingOperations
}

// Manifests arrive parsed; the RPC boundary verified the digest over the bytes as sent.
export class HelixdCatalogImportPersistence {
  readonly [helixdCatalogImportContext]: HelixdCatalogImportContext

  constructor(
    runtime: HelixdCatalogImportRuntime,
    repos: RepoLifecycleOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[helixdCatalogImportContext] = { runtime, repos, scheduling }
  }

  stageHelixdMigrationCatalog(
    manifest: HelixdMigrationManifest,
    options: { now?: () => Date } = {}
  ): HelixdMigrationCatalogState {
    const context = this[helixdCatalogImportContext]
    const now = options.now ?? (() => new Date())
    if (expireHelixdMigrationStages(context.runtime.state, now().getTime())) {
      scheduleSave(context.scheduling)
    }
    pruneHelixdMigrationSnapshotStaging(
      stagedManifests(context.runtime.state),
      context.runtime.terminalScrollbackSnapshotStorage
    )
    pruneHelixdMigrationBlobStaging(
      stagedManifests(context.runtime.state),
      committedMigrations(context.runtime.state),
      context.runtime.helixdMigrationBlobRoot
    )
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    prepareHelixdMigrationCatalog(manifest, context.runtime.state)
    if (current.state === 'staged') {
      return current
    }
    const staged = context.runtime.state.helixdMigrationStagedCatalogs ?? []
    if (staged.length >= MAX_HELIXD_MIGRATION_STAGED_CATALOGS) {
      throw new Error('helixd_migration_staging_capacity_exceeded')
    }
    const stagedAt = now().toISOString()
    context.runtime.state.helixdMigrationStagedCatalogs = [
      ...staged,
      {
        version: HELIXD_MIGRATION_MANIFEST_VERSION,
        manifest: structuredClone(manifest),
        stagedAt
      }
    ]
    scheduleSave(context.scheduling)
    return stagedCatalogState(manifest, stagedAt, context.runtime)
  }

  stageHelixdMigrationSnapshotChunk(
    request: HelixdMigrationSnapshotChunkRequest
  ): HelixdMigrationSnapshotChunkResult {
    const context = this[helixdCatalogImportContext]
    return stageHelixdMigrationSnapshotChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      storage: context.runtime.terminalScrollbackSnapshotStorage,
      request
    })
  }

  stageHelixdMigrationBlobChunk(
    request: HelixdMigrationBlobChunkRequest
  ): HelixdMigrationBlobChunkResult {
    const context = this[helixdCatalogImportContext]
    return stageHelixdMigrationBlobChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      root: context.runtime.helixdMigrationBlobRoot,
      request
    })
  }

  /** Omitted expectedBlobs preserves older senders' commit behavior. */
  commitStagedHelixdMigrationCatalog(
    manifest: HelixdMigrationManifest,
    options: { now?: () => Date; expectedBlobs?: readonly HelixdMigrationBlobDescriptor[] } = {}
  ): HelixdMigrationCatalogState {
    const context = this[helixdCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    if (current.state !== 'staged') {
      throw new Error('helixd_migration_catalog_not_staged')
    }
    const prepared = prepareHelixdMigrationCatalog(manifest, context.runtime.state)
    const blobRoot = context.runtime.helixdMigrationBlobRoot
    assertHelixdMigrationSnapshotsReady(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    if (options.expectedBlobs) {
      assertHelixdMigrationBlobSetMatches(manifest, blobRoot, options.expectedBlobs)
    }
    assertHelixdMigrationBlobsReady(manifest, blobRoot)
    assertHelixdMigrationBlobContentsValid(manifest, blobRoot)
    commitHelixdMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    commitHelixdMigrationBlobs(manifest, blobRoot)
    const receipt = commitPreparedCatalog(context, manifest, prepared, options.now)
    const generationBefore = context.runtime.writeGeneration
    scheduleSave(context.scheduling)
    recordHelixdMigrationCommitWriteGeneration(context.runtime, manifest, generationBefore)
    return committedCatalogState(receipt)
  }

  abortStagedHelixdMigrationCatalog(
    manifest: HelixdMigrationManifest
  ): HelixdMigrationCatalogAbortResult {
    const context = this[helixdCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed' || current.state === 'absent') {
      return { ...current, aborted: false }
    }
    // Staged rows are dormant and unreferenced outside this stage.
    context.runtime.state.helixdMigrationStagedCatalogs = (
      context.runtime.state.helixdMigrationStagedCatalogs ?? []
    ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
    abortHelixdMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    abortHelixdMigrationBlobs(manifest, context.runtime.helixdMigrationBlobRoot)
    scheduleSave(context.scheduling)
    return { ...absentCatalogState(manifest), aborted: true }
  }

  /** Use the stored manifest when the source cannot send one. */
  abortStagedHelixdMigrationCatalogByReference(
    reference: HelixdMigrationCatalogReference
  ): HelixdMigrationCatalogReferenceAbortResult {
    return abortHelixdMigrationCatalogByReference(
      this[helixdCatalogImportContext].runtime.state,
      reference,
      (manifest) => this.abortStagedHelixdMigrationCatalog(manifest)
    )
  }

  getHelixdMigrationCatalogState(manifest: HelixdMigrationManifest): HelixdMigrationCatalogState {
    const context = this[helixdCatalogImportContext]
    return migrationCatalogState(context.runtime, manifest)
  }

  hasStagedHelixdMigrationCatalog(now: number = Date.now()): boolean {
    return (
      this[helixdCatalogImportContext].runtime.state.helixdMigrationStagedCatalogs ?? []
    ).some((entry) => isLiveHelixdMigrationStage(entry.stagedAt, now))
  }
}

function commitPreparedCatalog(
  context: HelixdCatalogImportContext,
  manifest: HelixdMigrationManifest,
  prepared: PreparedHelixdMigrationCatalog,
  now?: () => Date
): HelixdMigrationImportReceipt {
  applyPreparedHelixdMigrationCatalog(prepared, context.runtime.state, context.repos)
  const receipt: HelixdMigrationImportReceipt = {
    version: HELIXD_MIGRATION_MANIFEST_VERSION,
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    source: structuredClone(manifest.source),
    importedAt: (now ?? (() => new Date()))().toISOString(),
    repositoryIds: prepared.repositories.map((repo) => repo.id),
    projectGroupIds: prepared.projectGroups.map((group) => group.id),
    folderWorkspaceIds: prepared.folderWorkspaces.map((workspace) => workspace.id)
  }
  context.runtime.state.helixdMigrationStagedCatalogs = (
    context.runtime.state.helixdMigrationStagedCatalogs ?? []
  ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
  recordHelixdMigrationImportReceipt(context.runtime.state, receipt)
  return receipt
}

function migrationCatalogState(
  runtime: HelixdCatalogImportRuntime,
  manifest: HelixdMigrationManifest
): HelixdMigrationCatalogState {
  const { state } = runtime
  const receipt = findHelixdMigrationImportReceipt(state, manifest)
  if (receipt) {
    assertCommittedReceipt(receipt, manifest)
    return committedCatalogState(receipt)
  }
  const staged = state.helixdMigrationStagedCatalogs?.find(
    (entry) => entry.manifest.migrationId === manifest.migrationId
  )
  if (!staged) {
    return absentCatalogState(manifest)
  }
  assertSameHelixdMigrationManifest(staged.manifest, manifest)
  return stagedCatalogState(manifest, staged.stagedAt, runtime)
}

// A committed receipt stays authoritative even after live rows and snapshots change.
function assertCommittedReceipt(
  receipt: HelixdMigrationImportReceipt,
  manifest: HelixdMigrationManifest
): void {
  if (receipt.manifestSha256 !== manifest.manifestSha256) {
    throw new Error('helixd_migration_id_reused_with_different_manifest')
  }
  assertHelixdMigrationReceiptMatchesManifest(receipt, manifest)
}

function absentCatalogState(manifest: HelixdMigrationManifest): HelixdMigrationCatalogState {
  return {
    state: 'absent',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256
  }
}

function stagedCatalogState(
  manifest: HelixdMigrationManifest,
  stagedAt: string,
  runtime: HelixdCatalogImportRuntime
): HelixdMigrationCatalogState {
  const snapshotUploads = inspectHelixdMigrationSnapshotUploads(
    manifest,
    runtime.terminalScrollbackSnapshotStorage
  )
  // Omit absent uploads to preserve older hosts' response shape.
  const blobUploads = inspectHelixdMigrationBlobUploads(manifest, runtime.helixdMigrationBlobRoot)
  return {
    state: 'staged',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    stagedAt,
    ...(snapshotUploads ? { snapshotUploads } : {}),
    ...(blobUploads ? { blobUploads } : {})
  }
}

function committedCatalogState(receipt: HelixdMigrationImportReceipt): HelixdMigrationCatalogState {
  return {
    state: 'committed',
    migrationId: receipt.migrationId,
    manifestSha256: receipt.manifestSha256,
    receipt: structuredClone(receipt)
  }
}
