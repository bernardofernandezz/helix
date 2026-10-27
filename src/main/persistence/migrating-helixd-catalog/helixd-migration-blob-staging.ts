// The manifest omits blobs; descriptor filenames make staged uploads resumable after restart.
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  HELIXD_MIGRATION_BLOB_KINDS,
  assertHelixdMigrationBlobSet,
  decodeHelixdMigrationBlobChunk,
  helixdMigrationBlobIdentity,
  parseHelixdMigrationBlobDescriptor,
  sameHelixdMigrationBlob,
  type HelixdMigrationBlobChunkRequest,
  type HelixdMigrationBlobChunkResult,
  type HelixdMigrationBlobDescriptor,
  type HelixdMigrationBlobKind,
  type HelixdMigrationBlobUploadState
} from '../../../shared/helixd-migration/helixd-migration-blob-transfer'
import type { HelixdMigrationManifest } from '../../../shared/helixd-migration/helixd-migration-manifest'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  appendHelixdMigrationStagedChunk,
  ensureHelixdMigrationDirectory,
  inspectHelixdMigrationFinalFile,
  linkHelixdMigrationStagedFile,
  helixdMigrationFileMatches,
  helixdMigrationStagedFileSize,
  helixdMigrationStagingDirectory,
  helixdMigrationStagingKey,
  pruneHelixdMigrationKeyedDirectories,
  pruneHelixdMigrationStagingDirectories,
  removeHelixdMigrationStagingDirectory,
  requireStagedHelixdMigrationManifest,
  type HelixdMigrationRequestIdentity
} from './helixd-migration-staged-file'

const RECEIVED_DIRECTORY = 'received'
const STAGED_BLOB_NAME = /^([^.]+)\.([a-f0-9]{64})\.([1-9][0-9]*)\.part$/

type HelixdMigrationBlobName = Pick<HelixdMigrationBlobDescriptor, 'blobKind' | 'key'>

type ReceivedBlobPathResolver = (
  root: string,
  manifest: HelixdMigrationRequestIdentity,
  descriptor: HelixdMigrationBlobName
) => string

const receivedDirectoryPath: ReceivedBlobPathResolver = (root, manifest, descriptor) =>
  join(receivedBlobsDirectory(root, manifest), descriptor.blobKind, descriptor.key)

const RECEIVED_BLOB_DESTINATIONS: Record<HelixdMigrationBlobKind, ReceivedBlobPathResolver> = {
  'terminal-restore-hints': receivedDirectoryPath,
  'shell-history': receivedDirectoryPath,
  'agent-session-records': receivedDirectoryPath
}

export function getHelixdMigrationReceivedBlobPath(
  root: string,
  manifest: HelixdMigrationRequestIdentity,
  descriptor: HelixdMigrationBlobName
): string {
  return RECEIVED_BLOB_DESTINATIONS[descriptor.blobKind](root, manifest, descriptor)
}

export function listHelixdMigrationReceivedBlobNames(
  root: string,
  manifest: HelixdMigrationRequestIdentity,
  blobKind: HelixdMigrationBlobKind
): string[] {
  return readDirectory(join(receivedBlobsDirectory(root, manifest), blobKind))
}

export type HelixdMigrationBlobChunkStaging = {
  stagedManifest: HelixdMigrationManifest | null
  root: string
  request: HelixdMigrationBlobChunkRequest
}

export function stageHelixdMigrationBlobChunk(
  args: HelixdMigrationBlobChunkStaging
): HelixdMigrationBlobChunkResult {
  const manifest = requireStagedHelixdMigrationManifest(
    args.stagedManifest,
    args.request,
    'helixd_migration_blob_catalog_not_staged'
  )
  const descriptor = parseHelixdMigrationBlobDescriptor(args.request.blob)
  const bytes = decodeHelixdMigrationBlobChunk(args.request.bytesBase64)
  const staged = stagedBlobDescriptors(args.root, manifest)
  const existing = staged.find(
    (entry) => helixdMigrationBlobIdentity(entry) === helixdMigrationBlobIdentity(descriptor)
  )
  if (existing && !sameHelixdMigrationBlob(existing, descriptor)) {
    // Replacing staged bytes requires abort and restage.
    throw new Error(`helixd_migration_blob_descriptor_conflict:${descriptor.blobKind}`)
  }
  if (!existing) {
    assertHelixdMigrationBlobSet([...staged, descriptor])
  }
  const path = stagedBlobPath(args.root, manifest, descriptor)
  ensureHelixdMigrationDirectory(dirname(path))
  const receivedBytes = appendHelixdMigrationStagedChunk({
    channel: 'blob',
    path,
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    blobKind: descriptor.blobKind,
    key: descriptor.key,
    receivedBytes
  }
}

export function inspectHelixdMigrationBlobUploads(
  manifest: HelixdMigrationManifest,
  root: string
): HelixdMigrationBlobUploadState[] | undefined {
  const uploads = stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectReceivedBlob(root, manifest, descriptor) === 'matching'
        ? descriptor.byteLength
        : helixdMigrationStagedFileSize(
            stagedBlobPath(root, manifest, descriptor),
            descriptor.byteLength
          )
  }))
  return uploads.length > 0 ? uploads : undefined
}

export function assertHelixdMigrationBlobsReady(
  manifest: HelixdMigrationManifest,
  root: string
): void {
  for (const upload of inspectHelixdMigrationBlobUploads(manifest, root) ?? []) {
    const label = `${upload.blobKind}:${upload.key}`
    const finalStatus = inspectReceivedBlob(root, manifest, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`helixd_migration_blob_destination_conflict:${label}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`helixd_migration_blob_incomplete:${label}`)
    }
    if (
      finalStatus !== 'matching' &&
      !helixdMigrationFileMatches(stagedBlobPath(root, manifest, upload), upload)
    ) {
      throw new Error(`helixd_migration_blob_digest_mismatch:${label}`)
    }
  }
}

/** Verified staged files; call after assertHelixdMigrationBlobsReady in the same synchronous turn. */
export function stagedHelixdMigrationBlobFiles(
  manifest: HelixdMigrationManifest,
  root: string
): { descriptor: HelixdMigrationBlobDescriptor; path: string }[] {
  return stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    descriptor,
    path: stagedBlobPath(root, manifest, descriptor)
  }))
}

/** Reject missing or extra blobs, including leftovers from another capture. */
export function assertHelixdMigrationBlobSetMatches(
  manifest: HelixdMigrationManifest,
  root: string,
  expected: readonly HelixdMigrationBlobDescriptor[]
): void {
  assertHelixdMigrationBlobSet(expected)
  const wanted = new Map(expected.map((entry) => [helixdMigrationBlobIdentity(entry), entry]))
  const staged = stagedBlobDescriptors(root, manifest)
  const stagedIds = new Set(staged.map(helixdMigrationBlobIdentity))
  for (const descriptor of staged) {
    const match = wanted.get(helixdMigrationBlobIdentity(descriptor))
    if (!match || !sameHelixdMigrationBlob(match, descriptor)) {
      throw blobSetMismatch(descriptor)
    }
  }
  for (const identity of receivedBlobIdentities(root, manifest)) {
    if (!wanted.has(identity)) {
      throw new Error('helixd_migration_blob_set_mismatch')
    }
  }
  for (const descriptor of expected) {
    // Previous commit attempts may have moved these bytes to received.
    if (
      !stagedIds.has(helixdMigrationBlobIdentity(descriptor)) &&
      inspectReceivedBlob(root, manifest, descriptor) !== 'matching'
    ) {
      throw blobSetMismatch(descriptor)
    }
  }
}

/** Call assertHelixdMigrationBlobsReady in the same synchronous turn so no chunk can change verified bytes. */
export function commitHelixdMigrationBlobs(manifest: HelixdMigrationManifest, root: string): void {
  const directories = new Set<string>()
  for (const descriptor of stagedBlobDescriptors(root, manifest)) {
    const finalPath = getHelixdMigrationReceivedBlobPath(root, manifest, descriptor)
    ensureHelixdMigrationDirectory(dirname(finalPath))
    linkHelixdMigrationStagedFile({
      stagedPath: stagedBlobPath(root, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `helixd_migration_blob_destination_conflict:${descriptor.blobKind}:${descriptor.key}`
    })
    directories.add(dirname(finalPath))
  }
  for (const directory of directories) {
    syncDirectoryDurablySync(directory)
  }
  removeHelixdMigrationStagingDirectory(root, manifest)
}

/** Also remove blobs moved by a commit that never landed. */
export function abortHelixdMigrationBlobs(manifest: HelixdMigrationManifest, root: string): void {
  removeHelixdMigrationStagingDirectory(root, manifest)
  rmSync(receivedBlobsDirectory(root, manifest), { recursive: true, force: true })
}

export function pruneHelixdMigrationBlobStaging(
  stagedManifests: readonly HelixdMigrationManifest[],
  committedMigrations: readonly HelixdMigrationRequestIdentity[],
  root: string
): void {
  pruneHelixdMigrationStagingDirectories(root, stagedManifests)
  pruneHelixdMigrationKeyedDirectories(join(root, RECEIVED_DIRECTORY), [
    ...stagedManifests,
    ...committedMigrations
  ])
}

function blobSetMismatch(descriptor: HelixdMigrationBlobDescriptor): Error {
  return new Error(`helixd_migration_blob_set_mismatch:${descriptor.blobKind}:${descriptor.key}`)
}

function receivedBlobIdentities(root: string, manifest: HelixdMigrationManifest): string[] {
  const received = receivedBlobsDirectory(root, manifest)
  return HELIXD_MIGRATION_BLOB_KINDS.flatMap((blobKind) =>
    readDirectory(join(received, blobKind)).map((key) =>
      helixdMigrationBlobIdentity({ blobKind, key })
    )
  )
}

function stagedBlobDescriptors(
  root: string,
  manifest: HelixdMigrationManifest
): HelixdMigrationBlobDescriptor[] {
  const staging = helixdMigrationStagingDirectory(root, manifest)
  const descriptors: HelixdMigrationBlobDescriptor[] = []
  for (const blobKind of HELIXD_MIGRATION_BLOB_KINDS) {
    for (const name of readDirectory(join(staging, blobKind))) {
      const match = STAGED_BLOB_NAME.exec(name)
      if (!match) {
        continue
      }
      try {
        descriptors.push(
          parseHelixdMigrationBlobDescriptor({
            blobKind,
            key: match[1],
            sha256: match[2],
            byteLength: Number(match[3])
          })
        )
      } catch {
        // Foreign names cannot belong to the staged set.
      }
    }
  }
  return descriptors
}

function readDirectory(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}

function inspectReceivedBlob(
  root: string,
  manifest: HelixdMigrationManifest,
  descriptor: HelixdMigrationBlobDescriptor
): 'absent' | 'matching' | 'conflict' {
  return inspectHelixdMigrationFinalFile(
    getHelixdMigrationReceivedBlobPath(root, manifest, descriptor),
    descriptor
  )
}

function receivedBlobsDirectory(root: string, manifest: HelixdMigrationRequestIdentity): string {
  return join(root, RECEIVED_DIRECTORY, helixdMigrationStagingKey(manifest))
}

function stagedBlobPath(
  root: string,
  manifest: HelixdMigrationManifest,
  descriptor: HelixdMigrationBlobDescriptor
): string {
  return join(
    helixdMigrationStagingDirectory(root, manifest),
    descriptor.blobKind,
    `${descriptor.key}.${descriptor.sha256}.${descriptor.byteLength}.part`
  )
}
