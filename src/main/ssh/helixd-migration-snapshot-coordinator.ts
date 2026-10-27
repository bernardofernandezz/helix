/** Read snapshot chunks from source storage and verify manifest length/digest. Resume from destination offsets; re-read after lost acknowledgements instead of assuming delivery. This transport-independent driver retires nothing. */
import type {
  HelixdMigrationCatalogState,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'
import {
  decodeHelixdMigrationSnapshotChunk,
  type HelixdMigrationSnapshotChunkRequest,
  type HelixdMigrationSnapshotChunkResult
} from '../../shared/helixd-migration/helixd-migration-scrollback'
import type { Store } from '../persistence'

export type HelixdMigrationSnapshotSource = Pick<Store, 'readHelixdMigrationSourceSnapshotChunk'>

type HelixdMigrationSnapshotDestination = {
  readState: (manifest: HelixdMigrationManifest) => Promise<HelixdMigrationCatalogState>
  stageChunk: (
    request: HelixdMigrationSnapshotChunkRequest
  ) => Promise<HelixdMigrationSnapshotChunkResult>
}

export async function transferHelixdMigrationSnapshots(args: {
  source: HelixdMigrationSnapshotSource
  manifest: HelixdMigrationManifest
  state: Extract<HelixdMigrationCatalogState, { state: 'staged' }>
  destination: HelixdMigrationSnapshotDestination
}): Promise<void> {
  const snapshots = args.manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return
  }
  // Journal retention keeps bytes available after tab close, including retries.
  await sendSnapshots(args, snapshots)
}

async function sendSnapshots(
  args: Parameters<typeof transferHelixdMigrationSnapshots>[0],
  snapshots: NonNullable<
    NonNullable<HelixdMigrationManifest['payload']['dormantState']>['terminalScrollbackSnapshots']
  >
): Promise<void> {
  const offsets = new Map(
    (args.state.snapshotUploads ?? []).map((entry) => [entry.ref, entry.receivedBytes])
  )
  for (const snapshot of snapshots) {
    let offset = offsets.get(snapshot.ref)
    if (offset === undefined) {
      throw new Error('helixd_migration_snapshot_transfer_unsupported')
    }
    while (offset < snapshot.byteLength) {
      const chunk = args.source.readHelixdMigrationSourceSnapshotChunk(
        args.manifest,
        snapshot.ref,
        offset
      )
      if (chunk.totalBytes !== snapshot.byteLength || !chunk.bytesBase64) {
        throw new Error('helixd_migration_source_snapshot_changed')
      }
      const request: HelixdMigrationSnapshotChunkRequest = {
        migrationId: args.manifest.migrationId,
        manifestSha256: args.manifest.manifestSha256,
        ref: snapshot.ref,
        offset,
        bytesBase64: chunk.bytesBase64
      }
      const expectedOffset = offset + decodeHelixdMigrationSnapshotChunk(chunk.bytesBase64).length
      offset = await stageChunkWithRecovery(args, request, expectedOffset)
    }
  }
  const verified = await args.destination.readState(args.manifest)
  if (
    verified.state !== 'staged' ||
    (verified.snapshotUploads ?? []).length !== snapshots.length ||
    (verified.snapshotUploads ?? []).some((entry) => entry.receivedBytes !== entry.byteLength)
  ) {
    throw new Error('helixd_migration_snapshot_transfer_incomplete')
  }
}

async function stageChunkWithRecovery(
  args: { manifest: HelixdMigrationManifest; destination: HelixdMigrationSnapshotDestination },
  request: HelixdMigrationSnapshotChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await args.destination.stageChunk(request)
    if (result.acknowledgedOffset !== expectedOffset) {
      throw new Error('helixd_migration_snapshot_ack_invalid')
    }
    return result.acknowledgedOffset
  } catch (error) {
    try {
      const observed = await args.destination.readState(args.manifest)
      const received =
        observed.state === 'staged'
          ? observed.snapshotUploads?.find((entry) => entry.ref === request.ref)?.receivedBytes
          : undefined
      if (received === expectedOffset) {
        return received
      }
    } catch {
      // Unverifiable chunks retain the original failure.
    }
    throw error
  }
}
