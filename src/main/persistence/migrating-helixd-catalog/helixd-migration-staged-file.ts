// Fsync staged appends, verify retried ranges, and commit digest-checked files by hard link.
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'
import type { HelixdMigrationManifest } from '../../../shared/helixd-migration/helixd-migration-manifest'
import { syncDirectoryDurablySync } from '../../durable-file-write'

export const HELIXD_MIGRATION_STAGING_DIRECTORY = '.helixd-migration-staging'

/** Selects error codes such as helixd_migration_<channel>_offset_invalid. */
export type HelixdMigrationStagingChannel = 'snapshot' | 'blob'

export type HelixdMigrationRequestIdentity = { migrationId: string; manifestSha256: string }

export type HelixdMigrationStagedContent = { sha256: string; byteLength: number }

export type HelixdMigrationStagedChunk = {
  channel: HelixdMigrationStagingChannel
  path: string
  offset: number
  bytes: Buffer
  byteLength: number
}

/** Retried ranges must match; returns staged size. */
export function appendHelixdMigrationStagedChunk(chunk: HelixdMigrationStagedChunk): number {
  const { channel, path, offset, bytes } = chunk
  const descriptorFd = openStagedFile(path)
  try {
    const size = statSync(path).size
    if (offset > size || offset + bytes.length > chunk.byteLength) {
      throw new Error(`helixd_migration_${channel}_offset_invalid`)
    }
    if (offset < size) {
      if (offset + bytes.length > size) {
        throw new Error(`helixd_migration_${channel}_offset_invalid`)
      }
      const existing = Buffer.alloc(bytes.length)
      const read = readSync(descriptorFd, existing, 0, existing.length, offset)
      if (read !== bytes.length || !existing.equals(bytes)) {
        throw new Error(`helixd_migration_${channel}_retry_mismatch`)
      }
      return size
    }
    const written = writeSync(descriptorFd, bytes, 0, bytes.length, offset)
    if (written !== bytes.length) {
      throw new Error(`helixd_migration_${channel}_write_incomplete`)
    }
    fsyncSync(descriptorFd)
    return size + bytes.length
  } finally {
    closeSync(descriptorFd)
  }
}

export function helixdMigrationStagedFileSize(path: string, byteLength: number): number {
  try {
    return Math.min(statSync(path).size, byteLength)
  } catch {
    return 0
  }
}

export function helixdMigrationFileMatches(
  path: string,
  expected: HelixdMigrationStagedContent
): boolean {
  try {
    const bytes = readFileSync(path)
    return (
      bytes.length === expected.byteLength &&
      createHash('sha256').update(bytes).digest('hex') === expected.sha256
    )
  } catch {
    return false
  }
}

export function inspectHelixdMigrationFinalFile(
  path: string | null,
  expected: HelixdMigrationStagedContent
): 'absent' | 'matching' | 'conflict' {
  if (!path || !existsSync(path)) {
    return 'absent'
  }
  return helixdMigrationFileMatches(path, expected) ? 'matching' : 'conflict'
}

/** An identical final file makes a retried hard-link commit succeed; different bytes refuse. */
export function linkHelixdMigrationStagedFile(args: {
  stagedPath: string
  finalPath: string
  expected: HelixdMigrationStagedContent
  conflictError: string
}): void {
  if (inspectHelixdMigrationFinalFile(args.finalPath, args.expected) !== 'matching') {
    try {
      linkSync(args.stagedPath, args.finalPath)
    } catch (error) {
      const finalStatus = inspectHelixdMigrationFinalFile(args.finalPath, args.expected)
      if (finalStatus === 'conflict') {
        throw new Error(args.conflictError)
      }
      if (finalStatus !== 'matching') {
        throw error
      }
    }
  }
  rmSync(args.stagedPath, { force: true })
}

export function helixdMigrationStagingDirectory(
  root: string,
  manifest: HelixdMigrationManifest
): string {
  return join(root, HELIXD_MIGRATION_STAGING_DIRECTORY, helixdMigrationStagingKey(manifest))
}

export function ensureHelixdMigrationDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
}

export function removeHelixdMigrationStagingDirectory(
  root: string,
  manifest: HelixdMigrationManifest
): void {
  rmSync(helixdMigrationStagingDirectory(root, manifest), { recursive: true, force: true })
  syncDirectoryDurablySync(join(root, HELIXD_MIGRATION_STAGING_DIRECTORY))
}

export function pruneHelixdMigrationStagingDirectories(
  root: string,
  stagedManifests: readonly HelixdMigrationManifest[]
): void {
  pruneHelixdMigrationKeyedDirectories(
    join(root, HELIXD_MIGRATION_STAGING_DIRECTORY),
    stagedManifests
  )
}

export function pruneHelixdMigrationKeyedDirectories(
  parent: string,
  retainedMigrations: readonly HelixdMigrationRequestIdentity[]
): void {
  const retained = new Set(retainedMigrations.map(helixdMigrationStagingKey))
  let entries: string[]
  try {
    entries = readdirSync(parent)
  } catch {
    return
  }
  for (const entry of entries) {
    if (/^[a-f0-9]{32}$/.test(entry) && !retained.has(entry)) {
      rmSync(join(parent, entry), { recursive: true, force: true })
    }
  }
}

/** Refuse through the channel's error if its staged manifest does not match. */
export function requireStagedHelixdMigrationManifest(
  staged: HelixdMigrationManifest | null,
  request: HelixdMigrationRequestIdentity,
  notStagedError: string
): HelixdMigrationManifest {
  if (
    !staged ||
    staged.migrationId !== request.migrationId ||
    staged.manifestSha256 !== request.manifestSha256
  ) {
    throw new Error(notStagedError)
  }
  return staged
}

export function helixdMigrationStagingKey(manifest: HelixdMigrationRequestIdentity): string {
  return createHash('sha256')
    .update(`${manifest.migrationId}\0${manifest.manifestSha256}`)
    .digest('hex')
    .slice(0, 32)
}

function openStagedFile(path: string): number {
  try {
    return openSync(path, 'r+')
  } catch {
    try {
      return openSync(path, 'wx+', 0o600)
    } catch {
      return openSync(path, 'r+')
    }
  }
}
