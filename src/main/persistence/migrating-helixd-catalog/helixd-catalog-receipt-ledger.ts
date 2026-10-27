// Commit receipts remain authoritative indefinitely; abandoned stages expire.
import { MAX_HELIXD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/helixd-migration/helixd-migration-manifest-validation'
import type {
  HelixdMigrationImportReceipt,
  HelixdMigrationManifest
} from '../../../shared/helixd-migration/helixd-migration-manifest'
import { MAX_HELIXD_MIGRATION_EVICTED_RECEIPTS } from '../../../shared/helixd-migration/helixd-migration-evicted-receipts'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  helixdMigrationStagingKey,
  type HelixdMigrationRequestIdentity
} from './helixd-migration-staged-file'

// Allow a week for clients that went offline mid-move.
export const HELIXD_MIGRATION_STAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function findHelixdMigrationImportReceipt(
  state: PersistedState,
  manifest: HelixdMigrationManifest
): HelixdMigrationImportReceipt | undefined {
  const receipt = state.helixdMigrationImportReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  if (receipt) {
    return receipt
  }
  const evicted = state.helixdMigrationEvictedReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  // Rebuild the remaining receipt fields from the manifest.
  return evicted
    ? {
        version: manifest.version,
        migrationId: evicted.migrationId,
        manifestSha256: evicted.manifestSha256,
        source: structuredClone(manifest.source),
        importedAt: evicted.importedAt,
        repositoryIds: manifest.payload.repositories.map((repo) => repo.id),
        projectGroupIds: manifest.payload.projectGroups.map((group) => group.id),
        folderWorkspaceIds: manifest.payload.folderWorkspaces.map((workspace) => workspace.id)
      }
    : undefined
}

/** Compact evicted receipts without losing proof of commit. */
export function recordHelixdMigrationImportReceipt(
  state: PersistedState,
  receipt: HelixdMigrationImportReceipt
): void {
  const receipts = [...(state.helixdMigrationImportReceipts ?? []), receipt]
  const overflow = receipts.length - MAX_HELIXD_MIGRATION_IMPORT_RECEIPTS
  if (overflow > 0) {
    state.helixdMigrationEvictedReceipts = [
      ...(state.helixdMigrationEvictedReceipts ?? []),
      ...receipts.slice(0, overflow).map(({ migrationId, manifestSha256, importedAt }) => ({
        migrationId,
        manifestSha256,
        importedAt
      }))
    ].slice(-MAX_HELIXD_MIGRATION_EVICTED_RECEIPTS)
  }
  state.helixdMigrationImportReceipts = receipts.slice(-MAX_HELIXD_MIGRATION_IMPORT_RECEIPTS)
}

export function isLiveHelixdMigrationStage(stagedAt: string, now: number): boolean {
  return now - Date.parse(stagedAt) < HELIXD_MIGRATION_STAGE_TTL_MS
}

export function expireHelixdMigrationStages(state: PersistedState, now: number): boolean {
  const staged = state.helixdMigrationStagedCatalogs ?? []
  const live = staged.filter((entry) => isLiveHelixdMigrationStage(entry.stagedAt, now))
  if (live.length === staged.length) {
    return false
  }
  state.helixdMigrationStagedCatalogs = live
  return true
}

export type HelixdMigrationCommitGenerationRuntime = Pick<
  StoreRuntimeState,
  'writeGeneration' | 'lastDurableWriteGeneration' | 'helixdMigrationCommitWriteGenerations'
>

/** Call right after the commit's `scheduleSave`; `generationBefore` is read just before it. */
export function recordHelixdMigrationCommitWriteGeneration(
  runtime: HelixdMigrationCommitGenerationRuntime,
  migration: HelixdMigrationRequestIdentity,
  generationBefore: number
): void {
  // Suppressed saves never advance generation; only a disk-loaded receipt can prove durability.
  runtime.helixdMigrationCommitWriteGenerations.set(
    helixdMigrationStagingKey(migration),
    runtime.writeGeneration > generationBefore ? runtime.writeGeneration : Number.POSITIVE_INFINITY
  )
}

/** Require disk durability before consuming blobs a restart might need to retry. */
export function isHelixdMigrationCommitDurable(
  runtime: HelixdMigrationCommitGenerationRuntime,
  migration: HelixdMigrationRequestIdentity
): boolean {
  const key = helixdMigrationStagingKey(migration)
  const required = runtime.helixdMigrationCommitWriteGenerations.get(key)
  if (required === undefined) {
    return true
  }
  if (runtime.lastDurableWriteGeneration < required) {
    return false
  }
  runtime.helixdMigrationCommitWriteGenerations.delete(key)
  return true
}
