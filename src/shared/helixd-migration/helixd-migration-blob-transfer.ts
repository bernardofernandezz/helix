/** Opaque migration blobs travel beside the signed catalog. Gate each kind by its destination capability:
 * older destinations drop unknown kinds, so clients must refuse before staging. */
import { z } from 'zod'
import {
  HELIXD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  HelixdMigrationChunkBase64Schema,
  HelixdMigrationDigestSchema,
  HelixdMigrationIdentitySchema,
  decodeHelixdMigrationChunk
} from './helixd-migration-scrollback'
import { requiredRecord } from './helixd-migration-dormant-value-validation'
import { assertUniqueKeys } from './helixd-migration-manifest-fields'
import { HELIXD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../helixd-runtime-capabilities'

export const HELIXD_MIGRATION_BLOB_KINDS = [
  'terminal-restore-hints',
  'shell-history',
  'agent-session-records'
] as const

export type HelixdMigrationBlobKind = (typeof HELIXD_MIGRATION_BLOB_KINDS)[number]

type HelixdMigrationBlobKindContract = {
  /** Filename-safe, dot-free and lowercase, so a key is one path segment on any filesystem. */
  key: RegExp
  maxBytes: number
  capability: string
}

const MIB = 1024 * 1024

export const HELIXD_MIGRATION_BLOB_KIND_CONTRACTS: Record<
  HelixdMigrationBlobKind,
  HelixdMigrationBlobKindContract
> = {
  // One JSON document per migration; the received directory already scopes it to the migration.
  'terminal-restore-hints': {
    key: /^migration$/,
    maxBytes: 4 * MIB,
    capability: 'helixd.migration-blob.terminal-restore-hints.v1'
  },
  // `hashWorktreeId` (16 hex) plus the shell whose history file it is.
  'shell-history': {
    key: /^[a-f0-9]{16}-(?:zsh|bash|fish)$/,
    maxBytes: 64 * MIB,
    capability: 'helixd.migration-blob.shell-history.v1'
  },
  // The agent session id; agent CLIs mint lowercase UUID-like ids.
  'agent-session-records': {
    key: /^[a-z0-9][a-z0-9_-]{0,127}$/,
    maxBytes: 64 * MIB,
    capability: 'helixd.migration-blob.agent-session-records.v1'
  }
}

// The same bound the shared chunk decoder enforces for both channels.
export const HELIXD_MIGRATION_BLOB_CHUNK_BYTES = HELIXD_MIGRATION_SCROLLBACK_CHUNK_BYTES
export const MAX_HELIXD_MIGRATION_BLOBS = 1024
export const MAX_HELIXD_MIGRATION_BLOB_TOTAL_BYTES = 256 * MIB

/** Byte-for-byte what the destination must hold; empty content is sent as no blob at all. */
export type HelixdMigrationBlobDescriptor = {
  blobKind: HelixdMigrationBlobKind
  key: string
  sha256: string
  byteLength: number
}

export type HelixdMigrationBlobUploadState = HelixdMigrationBlobDescriptor & {
  receivedBytes: number
}

export const HELIXD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED =
  'helixd_migration_destination_blob_kind_unsupported'

// Windows refuses these as file names whatever the extension, so a key must never be one.
const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

export const HelixdMigrationBlobDescriptorSchema = z
  .object({
    blobKind: z.enum(HELIXD_MIGRATION_BLOB_KINDS),
    key: z.string().max(256),
    sha256: HelixdMigrationDigestSchema,
    byteLength: z.number().int().min(1)
  })
  .superRefine((value, context) => {
    const contract = HELIXD_MIGRATION_BLOB_KIND_CONTRACTS[value.blobKind]
    if (!contract.key.test(value.key) || WINDOWS_RESERVED_FILE_NAME.test(value.key)) {
      context.addIssue({
        code: 'custom',
        message: 'helixd_migration_blob_key_invalid'
      })
    }
    if (value.byteLength > contract.maxBytes) {
      context.addIssue({ code: 'custom', message: 'helixd_migration_blob_too_large' })
    }
  })

// Not strict: an older host must ignore optional fields a newer client adds.
export const HelixdMigrationBlobChunkRequestSchema = z.object({
  migrationId: HelixdMigrationIdentitySchema,
  manifestSha256: HelixdMigrationDigestSchema,
  blob: HelixdMigrationBlobDescriptorSchema,
  offset: z.number().int().nonnegative().max(MAX_HELIXD_MIGRATION_BLOB_TOTAL_BYTES),
  bytesBase64: HelixdMigrationChunkBase64Schema
})

export type HelixdMigrationBlobChunkRequest = z.infer<typeof HelixdMigrationBlobChunkRequestSchema>

export type HelixdMigrationBlobChunkResult = {
  migrationId: string
  manifestSha256: string
  blobKind: HelixdMigrationBlobKind
  key: string
  receivedBytes: number
}

export function parseHelixdMigrationBlobDescriptor(value: unknown): HelixdMigrationBlobDescriptor {
  const parsed = HelixdMigrationBlobDescriptorSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'helixd_migration_blob_descriptor_invalid')
  }
  return {
    blobKind: parsed.data.blobKind,
    key: parsed.data.key,
    sha256: parsed.data.sha256,
    byteLength: parsed.data.byteLength
  }
}

export function assertHelixdMigrationBlobSet(
  descriptors: readonly HelixdMigrationBlobDescriptor[]
): void {
  if (descriptors.length > MAX_HELIXD_MIGRATION_BLOBS) {
    throw new Error('helixd_migration_blobs_too_many')
  }
  assertUniqueKeys([...descriptors], helixdMigrationBlobIdentity, 'helixd_migration_blob_duplicate')
  const total = descriptors.reduce((sum, entry) => sum + entry.byteLength, 0)
  if (total > MAX_HELIXD_MIGRATION_BLOB_TOTAL_BYTES) {
    throw new Error('helixd_migration_blobs_too_large')
  }
}

export function helixdMigrationBlobIdentity(
  descriptor: Pick<HelixdMigrationBlobDescriptor, 'blobKind' | 'key'>
): string {
  return `${descriptor.blobKind}\0${descriptor.key}`
}

export function sameHelixdMigrationBlob(
  left: HelixdMigrationBlobDescriptor,
  right: HelixdMigrationBlobDescriptor
): boolean {
  return (
    left.blobKind === right.blobKind &&
    left.key === right.key &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  )
}

/** The channel plus each kind's capability; empty when nothing is sent. */
export function requiredMigrationBlobCapabilities(
  descriptors: readonly Pick<HelixdMigrationBlobDescriptor, 'blobKind'>[]
): string[] {
  if (descriptors.length === 0) {
    return []
  }
  const kinds = new Set(descriptors.map((entry) => entry.blobKind))
  return [
    HELIXD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...HELIXD_MIGRATION_BLOB_KINDS.filter((kind) => kinds.has(kind)).map(
      (kind) => HELIXD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability
    )
  ]
}

/** The first kind the destination cannot install, so the refusal names what would be lost. */
export function findUnsupportedMigrationBlobKind(
  descriptors: readonly Pick<HelixdMigrationBlobDescriptor, 'blobKind'>[],
  capabilities: readonly string[]
): HelixdMigrationBlobKind | null {
  const advertised = new Set(capabilities)
  for (const descriptor of descriptors) {
    if (
      !advertised.has(HELIXD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY) ||
      !advertised.has(HELIXD_MIGRATION_BLOB_KIND_CONTRACTS[descriptor.blobKind].capability)
    ) {
      return descriptor.blobKind
    }
  }
  return null
}

export function helixdMigrationBlobKindUnsupportedBlocker(kind: HelixdMigrationBlobKind): string {
  return `${HELIXD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED}:${kind}:Update Helix on this host to move this project's ${kind} to it.`
}

export function decodeHelixdMigrationBlobChunk(bytesBase64: string): Buffer {
  return decodeHelixdMigrationChunk(bytesBase64, 'helixd_migration_blob_chunk_invalid')
}

/** Absent on hosts that predate blobs or hold none staged; both mean every blob starts at 0. */
export function parseHelixdMigrationBlobUploadStates(
  value: unknown
): HelixdMigrationBlobUploadState[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length > MAX_HELIXD_MIGRATION_BLOBS) {
    throw new Error('helixd_migration_blob_state_invalid')
  }
  const uploads = value.map((entry) => {
    // Fails closed on an unknown kind by design: only blobs this desktop staged can appear here.
    const record = requiredRecord(entry, 'helixd_migration_blob_state_invalid')
    const descriptor = parseHelixdMigrationBlobDescriptor(record)
    if (
      !Number.isSafeInteger(record.receivedBytes) ||
      Number(record.receivedBytes) < 0 ||
      Number(record.receivedBytes) > descriptor.byteLength
    ) {
      throw new Error('helixd_migration_blob_state_invalid')
    }
    return { ...descriptor, receivedBytes: Number(record.receivedBytes) }
  })
  assertHelixdMigrationBlobSet(uploads)
  return uploads
}

export function parseHelixdMigrationBlobChunkResult(
  value: unknown,
  request: HelixdMigrationBlobChunkRequest
): HelixdMigrationBlobChunkResult {
  const record = requiredRecord(value, 'helixd_migration_blob_chunk_result_invalid')
  const receivedBytes = request.offset + decodeHelixdMigrationBlobChunk(request.bytesBase64).length
  if (
    record.migrationId !== request.migrationId ||
    record.manifestSha256 !== request.manifestSha256 ||
    record.blobKind !== request.blob.blobKind ||
    record.key !== request.blob.key ||
    record.receivedBytes !== receivedBytes
  ) {
    throw new Error('helixd_migration_blob_chunk_result_invalid')
  }
  return {
    migrationId: request.migrationId,
    manifestSha256: request.manifestSha256,
    blobKind: request.blob.blobKind,
    key: request.blob.key,
    receivedBytes
  }
}

/** Kinds this build's destination installs after commit; each is added with its installer. */
export const HELIXD_MIGRATION_INSTALLABLE_BLOB_KINDS: readonly HelixdMigrationBlobKind[] = [
  'terminal-restore-hints',
  'shell-history'
]

export function advertisedHelixdMigrationBlobCapabilities(): string[] {
  return [
    HELIXD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...HELIXD_MIGRATION_INSTALLABLE_BLOB_KINDS.map(
      (kind) => HELIXD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability
    )
  ]
}
