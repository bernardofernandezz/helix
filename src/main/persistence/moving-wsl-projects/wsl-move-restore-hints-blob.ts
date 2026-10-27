import { createHash } from 'node:crypto'
import type { HelixdMigrationBlobDescriptor } from '../../../shared/helixd-migration/helixd-migration-blob-transfer'
import { sameHelixdMigrationBlob } from '../../../shared/helixd-migration/helixd-migration-blob-transfer'
import {
  MAX_HELIXD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES,
  HELIXD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  HELIXD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
  parseHelixdMigrationTerminalRestoreHintsDocument,
  type HelixdMigrationTerminalRestoreHint
} from '../../../shared/helixd-migration/helixd-migration-terminal-restore-hints'
import type { HelixdMigrationBlobSource } from '../../ssh/helixd-migration-blob-coordinator'

export type WslMoveRestoreHintsBlob = {
  descriptor: HelixdMigrationBlobDescriptor
  bytes: Buffer
  source: HelixdMigrationBlobSource
}

/** Omit the blob when there are no hints. */
export function buildWslMoveRestoreHintsBlob(
  hints: readonly HelixdMigrationTerminalRestoreHint[]
): WslMoveRestoreHintsBlob | null {
  if (hints.length === 0) {
    return null
  }
  // Validate before staging so malformed hints fail while the source still owns the move.
  const document = parseHelixdMigrationTerminalRestoreHintsDocument({
    version: HELIXD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
    hints: hints.map((hint) => ({ paneKey: hint.paneKey, cwd: hint.cwd }))
  })
  const bytes = Buffer.from(JSON.stringify(document), 'utf8')
  if (bytes.length > MAX_HELIXD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES) {
    throw new Error('helixd_migration_terminal_restore_hints_too_large')
  }
  const descriptor: HelixdMigrationBlobDescriptor = {
    blobKind: 'terminal-restore-hints',
    key: HELIXD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
  return {
    descriptor,
    bytes,
    source: {
      readChunk: async (requested, offset, maxBytes) => {
        if (!sameHelixdMigrationBlob(requested, descriptor)) {
          throw new Error(`helixd_migration_source_blob_changed:${requested.blobKind}`)
        }
        return bytes.subarray(offset, offset + maxBytes)
      }
    }
  }
}
