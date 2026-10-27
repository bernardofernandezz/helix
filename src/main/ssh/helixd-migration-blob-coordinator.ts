/** Check every blob kind against destination capabilities before uploading. Resume from staged offsets and confirm lost acknowledgements by re-reading state; never assume delivery or silently omit unsupported data. */
import {
  HELIXD_MIGRATION_BLOB_CHUNK_BYTES,
  type HelixdMigrationBlobChunkRequest,
  type HelixdMigrationBlobChunkResult,
  type HelixdMigrationBlobDescriptor,
  assertHelixdMigrationBlobSet,
  findUnsupportedMigrationBlobKind,
  helixdMigrationBlobIdentity,
  helixdMigrationBlobKindUnsupportedBlocker,
  sameHelixdMigrationBlob
} from '../../shared/helixd-migration/helixd-migration-blob-transfer'
import type {
  HelixdMigrationCatalogState,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'

export type HelixdMigrationBlobSource = {
  /** Return the descriptor's exact hashed bytes at offset, up to maxBytes. */
  readChunk: (
    descriptor: HelixdMigrationBlobDescriptor,
    offset: number,
    maxBytes: number
  ) => Promise<Buffer>
}

export type HelixdMigrationBlobDestination = {
  readCapabilities: () => Promise<readonly string[]>
  readState: (manifest: HelixdMigrationManifest) => Promise<HelixdMigrationCatalogState>
  stageChunk: (request: HelixdMigrationBlobChunkRequest) => Promise<HelixdMigrationBlobChunkResult>
}

type HelixdMigrationBlobTransfer = {
  source: HelixdMigrationBlobSource
  manifest: HelixdMigrationManifest
  blobs: readonly HelixdMigrationBlobDescriptor[]
  destination: HelixdMigrationBlobDestination
}

type StagedCatalogState = Extract<HelixdMigrationCatalogState, { state: 'staged' }>

export async function transferHelixdMigrationBlobs(
  transfer: HelixdMigrationBlobTransfer
): Promise<void> {
  if (transfer.blobs.length === 0) {
    return
  }
  assertHelixdMigrationBlobSet(transfer.blobs)
  const unsupported = findUnsupportedMigrationBlobKind(
    transfer.blobs,
    await transfer.destination.readCapabilities()
  )
  if (unsupported) {
    throw new Error(helixdMigrationBlobKindUnsupportedBlocker(unsupported))
  }
  const offsets = receivedOffsets(transfer, await readStagedState(transfer))
  for (const blob of transfer.blobs) {
    let offset = offsets.get(helixdMigrationBlobIdentity(blob)) ?? 0
    while (offset < blob.byteLength) {
      const bytes = await transfer.source.readChunk(
        blob,
        offset,
        Math.min(HELIXD_MIGRATION_BLOB_CHUNK_BYTES, blob.byteLength - offset)
      )
      if (
        bytes.length === 0 ||
        bytes.length > HELIXD_MIGRATION_BLOB_CHUNK_BYTES ||
        offset + bytes.length > blob.byteLength
      ) {
        throw new Error(`helixd_migration_source_blob_changed:${blob.blobKind}`)
      }
      const request: HelixdMigrationBlobChunkRequest = {
        migrationId: transfer.manifest.migrationId,
        manifestSha256: transfer.manifest.manifestSha256,
        blob: { ...blob },
        offset,
        bytesBase64: bytes.toString('base64')
      }
      offset = await stageChunkWithRecovery(transfer, request, offset + bytes.length)
    }
  }
  assertAllReceived(transfer, await readStagedState(transfer))
}

async function readStagedState(transfer: HelixdMigrationBlobTransfer): Promise<StagedCatalogState> {
  const state = await transfer.destination.readState(transfer.manifest)
  if (state.state !== 'staged') {
    throw new Error('helixd_migration_blob_catalog_not_staged')
  }
  return state
}

function receivedOffsets(
  transfer: HelixdMigrationBlobTransfer,
  state: StagedCatalogState
): Map<string, number> {
  const wanted = new Map(transfer.blobs.map((blob) => [helixdMigrationBlobIdentity(blob), blob]))
  const offsets = new Map<string, number>()
  for (const upload of state.blobUploads ?? []) {
    const blob = wanted.get(helixdMigrationBlobIdentity(upload))
    // A reused key with different bytes is another capture; restaging would mix them.
    if (!blob || !sameHelixdMigrationBlob(blob, upload)) {
      throw new Error(`helixd_migration_blob_descriptor_conflict:${upload.blobKind}`)
    }
    offsets.set(helixdMigrationBlobIdentity(upload), upload.receivedBytes)
  }
  return offsets
}

function assertAllReceived(transfer: HelixdMigrationBlobTransfer, state: StagedCatalogState): void {
  const received = receivedOffsets(transfer, state)
  for (const blob of transfer.blobs) {
    if (received.get(helixdMigrationBlobIdentity(blob)) !== blob.byteLength) {
      throw new Error(`helixd_migration_blob_transfer_incomplete:${blob.blobKind}`)
    }
  }
}

async function stageChunkWithRecovery(
  transfer: HelixdMigrationBlobTransfer,
  request: HelixdMigrationBlobChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await transfer.destination.stageChunk(request)
    if (result.receivedBytes !== expectedOffset) {
      throw new Error('helixd_migration_blob_ack_invalid')
    }
    return result.receivedBytes
  } catch (error) {
    try {
      const observed = await transfer.destination.readState(transfer.manifest)
      const received =
        observed.state === 'staged'
          ? observed.blobUploads?.find(
              (entry) =>
                helixdMigrationBlobIdentity(entry) === helixdMigrationBlobIdentity(request.blob)
            )?.receivedBytes
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
