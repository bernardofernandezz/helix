import { normalizeHelixdMigrationImportReceipts } from './helixd-migration-manifest-validation'
import type {
  HelixdMigrationCatalogAbortResult,
  HelixdMigrationCatalogReferenceAbortResult,
  HelixdMigrationCatalogState,
  HelixdMigrationManifest
} from './helixd-migration-manifest'
import { parseHelixdMigrationSnapshotUploadStates } from './helixd-migration-scrollback'
import { parseHelixdMigrationBlobUploadStates } from './helixd-migration-blob-transfer'
import { isRecord } from './helixd-migration-manifest-fields'

export function parseHelixdMigrationCatalogState(
  value: unknown,
  manifest: HelixdMigrationManifest
): HelixdMigrationCatalogState {
  const record = requireRecord(value)
  if (
    record.migrationId !== manifest.migrationId ||
    record.manifestSha256 !== manifest.manifestSha256
  ) {
    throw new Error('helixd_migration_catalog_state_identity_mismatch')
  }
  if (record.state === 'absent') {
    return { state: 'absent', ...migrationIdentity(manifest) }
  }
  if (record.state === 'staged') {
    const stagedAt = requireDate(record.stagedAt)
    const snapshotUploads = parseHelixdMigrationSnapshotUploadStates(
      record.snapshotUploads,
      manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
    )
    const blobUploads = parseHelixdMigrationBlobUploadStates(record.blobUploads)
    return {
      state: 'staged',
      ...migrationIdentity(manifest),
      stagedAt,
      ...(snapshotUploads ? { snapshotUploads } : {}),
      ...(blobUploads ? { blobUploads } : {})
    }
  }
  if (record.state === 'committed') {
    const receipt = normalizeHelixdMigrationImportReceipts([record.receipt])[0]
    if (
      !receipt ||
      receipt.migrationId !== manifest.migrationId ||
      receipt.manifestSha256 !== manifest.manifestSha256
    ) {
      throw new Error('helixd_migration_catalog_state_receipt_invalid')
    }
    return { state: 'committed', ...migrationIdentity(manifest), receipt }
  }
  // No known arm is safe to assume for a newer host's state; stop with an actionable reason.
  if (typeof record.state === 'string') {
    throw new Error('helixd_migration_catalog_state_unsupported:client_update_required')
  }
  throw new Error('helixd_migration_catalog_state_invalid')
}

export function parseHelixdMigrationCatalogAbortResult(
  value: unknown,
  manifest: HelixdMigrationManifest
): HelixdMigrationCatalogAbortResult {
  const state = parseHelixdMigrationCatalogState(value, manifest)
  const record = requireRecord(value)
  if (typeof record.aborted !== 'boolean') {
    throw new Error('helixd_migration_catalog_abort_result_invalid')
  }
  if (
    record.durableAbsent !== undefined &&
    (record.durableAbsent !== true || state.state !== 'absent')
  ) {
    throw new Error('helixd_migration_catalog_abort_durability_invalid')
  }
  return {
    ...state,
    aborted: record.aborted,
    ...(record.durableAbsent === true ? { durableAbsent: true as const } : {})
  }
}

/** Absent only with the host's flush behind it: an unflushed abort could come back on restart. */
export function parseHelixdMigrationCatalogReferenceAbortResult(
  value: unknown,
  manifest: HelixdMigrationManifest
): HelixdMigrationCatalogReferenceAbortResult {
  const record = requireRecord(value)
  if (
    record.migrationId !== manifest.migrationId ||
    record.manifestSha256 !== manifest.manifestSha256
  ) {
    throw new Error('helixd_migration_catalog_state_identity_mismatch')
  }
  if (typeof record.aborted !== 'boolean') {
    throw new Error('helixd_migration_catalog_abort_result_invalid')
  }
  if (record.state === 'committed') {
    return { state: 'committed', ...migrationIdentity(manifest), aborted: false }
  }
  if (record.state === 'absent' && record.durableAbsent === true) {
    return {
      state: 'absent',
      ...migrationIdentity(manifest),
      aborted: record.aborted,
      durableAbsent: true
    }
  }
  throw new Error('helixd_migration_catalog_abort_durability_invalid')
}

function migrationIdentity(manifest: HelixdMigrationManifest) {
  return { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('helixd_migration_catalog_state_invalid')
  }
  return value
}

function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('helixd_migration_catalog_state_staged_at_invalid')
  }
  return value
}
