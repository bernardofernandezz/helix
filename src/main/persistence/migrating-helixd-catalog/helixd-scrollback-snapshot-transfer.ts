import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HelixdMigrationManifest } from '../../../shared/helixd-migration/helixd-migration-manifest'
import {
  decodeHelixdMigrationSnapshotChunk,
  type HelixdMigrationSnapshotChunkRequest,
  type HelixdMigrationSnapshotChunkResult,
  type HelixdMigrationSnapshotUploadState,
  type HelixdMigrationTerminalScrollbackSnapshot
} from '../../../shared/helixd-migration/helixd-migration-scrollback'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  getTerminalScrollbackSnapshotPath,
  getTerminalScrollbackSnapshotRoot,
  type TerminalScrollbackSnapshotStorage
} from '../../terminal-scrollback-snapshots'
import {
  appendHelixdMigrationStagedChunk,
  ensureHelixdMigrationDirectory,
  inspectHelixdMigrationFinalFile,
  linkHelixdMigrationStagedFile,
  helixdMigrationFileMatches,
  helixdMigrationStagedFileSize,
  helixdMigrationStagingDirectory,
  pruneHelixdMigrationStagingDirectories,
  removeHelixdMigrationStagingDirectory,
  requireStagedHelixdMigrationManifest
} from './helixd-migration-staged-file'

/** Only the staged manifest's snapshots may receive chunks; retried ranges must match. */
export function stageHelixdMigrationSnapshotChunk(args: {
  stagedManifest: HelixdMigrationManifest | null
  storage: TerminalScrollbackSnapshotStorage
  request: HelixdMigrationSnapshotChunkRequest
}): HelixdMigrationSnapshotChunkResult {
  const manifest = requireStagedHelixdMigrationManifest(
    args.stagedManifest,
    args.request,
    'helixd_migration_snapshot_catalog_not_staged'
  )
  const descriptor = requireDescriptor(manifest, args.request.ref)
  const bytes = decodeHelixdMigrationSnapshotChunk(args.request.bytesBase64)
  ensureHelixdMigrationDirectory(stagingDirectory(args.storage, manifest))
  const acknowledgedOffset = appendHelixdMigrationStagedChunk({
    channel: 'snapshot',
    path: stagedSnapshotPath(args.storage, manifest, descriptor),
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    ref: args.request.ref,
    acknowledgedOffset
  }
}

export function inspectHelixdMigrationSnapshotUploads(
  manifest: HelixdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): HelixdMigrationSnapshotUploadState[] | undefined {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return undefined
  }
  return snapshots.map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectFinalSnapshot(storage, descriptor) === 'matching'
        ? descriptor.byteLength
        : helixdMigrationStagedFileSize(
            stagedSnapshotPath(storage, manifest, descriptor),
            descriptor.byteLength
          )
  }))
}

export function assertHelixdMigrationSnapshotsReady(
  manifest: HelixdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  for (const upload of inspectHelixdMigrationSnapshotUploads(manifest, storage) ?? []) {
    const finalStatus = inspectFinalSnapshot(storage, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`helixd_migration_snapshot_destination_conflict:${upload.ref}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`helixd_migration_snapshot_incomplete:${upload.ref}`)
    }
    const path =
      finalStatus === 'matching'
        ? getTerminalScrollbackSnapshotPath(upload.ref, storage)
        : stagedSnapshotPath(storage, manifest, upload)
    if (!path || !helixdMigrationFileMatches(path, upload)) {
      throw new Error(`helixd_migration_snapshot_digest_mismatch:${upload.ref}`)
    }
  }
}

export function commitHelixdMigrationSnapshots(
  manifest: HelixdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  assertHelixdMigrationSnapshotsReady(manifest, storage)
  const root = getTerminalScrollbackSnapshotRoot(storage)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const descriptor of snapshots) {
    const finalPath = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
    if (!finalPath) {
      throw new Error('helixd_migration_snapshot_ref_invalid')
    }
    linkHelixdMigrationStagedFile({
      stagedPath: stagedSnapshotPath(storage, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `helixd_migration_snapshot_destination_conflict:${descriptor.ref}`
    })
  }
  syncDirectoryDurablySync(root)
  removeHelixdMigrationStagingDirectory(root, manifest)
}

export function abortHelixdMigrationSnapshots(
  manifest: HelixdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  removeHelixdMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

export function pruneHelixdMigrationSnapshotStaging(
  stagedManifests: readonly HelixdMigrationManifest[],
  storage: TerminalScrollbackSnapshotStorage
): void {
  pruneHelixdMigrationStagingDirectories(
    getTerminalScrollbackSnapshotRoot(storage),
    stagedManifests
  )
}

function requireDescriptor(
  manifest: HelixdMigrationManifest,
  ref: string
): HelixdMigrationTerminalScrollbackSnapshot {
  const descriptor = manifest.payload.dormantState?.terminalScrollbackSnapshots?.find(
    (entry) => entry.ref === ref
  )
  if (!descriptor) {
    throw new Error('helixd_migration_snapshot_unknown')
  }
  return descriptor
}

function inspectFinalSnapshot(
  storage: TerminalScrollbackSnapshotStorage,
  descriptor: HelixdMigrationTerminalScrollbackSnapshot
): 'absent' | 'matching' | 'conflict' {
  return inspectHelixdMigrationFinalFile(
    getTerminalScrollbackSnapshotPath(descriptor.ref, storage),
    descriptor
  )
}

function stagingDirectory(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: HelixdMigrationManifest
): string {
  return helixdMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

function stagedSnapshotPath(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: HelixdMigrationManifest,
  descriptor: HelixdMigrationTerminalScrollbackSnapshot
): string {
  return join(stagingDirectory(storage, manifest), `${descriptor.ref}.${descriptor.sha256}.part`)
}
