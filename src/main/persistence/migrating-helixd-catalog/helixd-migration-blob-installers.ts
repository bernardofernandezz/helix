// Validate blob contents before commit; install only advertised kinds after durable commit.
import { readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { HelixdMigrationBlobKind } from '../../../shared/helixd-migration/helixd-migration-blob-transfer'
import type { HelixdMigrationManifest } from '../../../shared/helixd-migration/helixd-migration-manifest'
import {
  HELIXD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  parseHelixdMigrationTerminalRestoreHintsText,
  type HelixdMigrationTerminalRestoreHint
} from '../../../shared/helixd-migration/helixd-migration-terminal-restore-hints'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  getHelixdMigrationReceivedBlobPath,
  stagedHelixdMigrationBlobFiles
} from './helixd-migration-blob-staging'
import {
  helixdMigrationStagingKey,
  type HelixdMigrationRequestIdentity
} from './helixd-migration-staged-file'
import {
  assertHelixdMigrationShellHistoryValid,
  installHelixdMigrationShellHistory
} from './helixd-shell-history-installer'
import type {
  HelixdTerminalRestoreHintPlacement,
  HelixdTerminalRestoreHintStore
} from './helixd-terminal-restore-hint-store'

type HelixdMigrationStagedBlobFile = {
  key: string
  path: string
  manifest: HelixdMigrationManifest
}

type HelixdMigrationBlobContentCheck = (file: HelixdMigrationStagedBlobFile) => void

const UTF8 = new TextDecoder('utf-8', { fatal: true })

const BLOB_CONTENT_CHECKS: Partial<
  Record<HelixdMigrationBlobKind, HelixdMigrationBlobContentCheck>
> = {
  'terminal-restore-hints': ({ path }) => {
    parseHelixdMigrationTerminalRestoreHintsText(decodeUtf8(readFileSync(path)))
  },
  'shell-history': ({ key, path, manifest }) => {
    assertHelixdMigrationShellHistoryValid(key, path, manifest.payload)
  }
}

/** Reject malformed content before commit while the source still owns everything. */
export function assertHelixdMigrationBlobContentsValid(
  manifest: HelixdMigrationManifest,
  root: string
): void {
  for (const { descriptor, path } of stagedHelixdMigrationBlobFiles(manifest, root)) {
    const check = BLOB_CONTENT_CHECKS[descriptor.blobKind]
    if (!check) {
      continue
    }
    try {
      check({ key: descriptor.key, path, manifest })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`helixd_migration_blob_content_invalid:${descriptor.blobKind}:${reason}`)
    }
  }
}

export type HelixdMigrationBlobInstall = {
  migration: HelixdMigrationRequestIdentity
  root: string
  terminalRestoreHints: HelixdTerminalRestoreHintStore
  /** This host's getHistoryRoot(). */
  shellHistoryRoot: string
  paneShellPath: () => string
  /** Defer without runtime evidence: shells surviving a restart could overwrite installed history. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
  deferredShellHistoryWorktreeIds: Set<string>
  paneWorktreeId: (paneKey: string) => string | null
  now: number
}

/** Retain failed blobs for retry; installed-migration markers prevent consumed hints from reviving. */
export function installHelixdMigrationReceivedBlobs(install: HelixdMigrationBlobInstall): void {
  let firstError: unknown = null
  // Keep failures independent so other blob kinds can still install.
  for (const installKind of [installTerminalRestoreHints, installShellHistory]) {
    try {
      installKind(install)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== null) {
    throw firstError
  }
}

function installShellHistory(install: HelixdMigrationBlobInstall): void {
  if (!install.worktreeHasLiveShells) {
    return
  }
  installHelixdMigrationShellHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.shellHistoryRoot,
    paneShellPath: install.paneShellPath,
    worktreeHasLiveShells: install.worktreeHasLiveShells,
    deferredWorktreeIds: install.deferredShellHistoryWorktreeIds,
    now: install.now
  })
}

function installTerminalRestoreHints(install: HelixdMigrationBlobInstall): void {
  const path = getHelixdMigrationReceivedBlobPath(install.root, install.migration, {
    blobKind: 'terminal-restore-hints',
    key: HELIXD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY
  })
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return
  }
  const migrationKey = helixdMigrationStagingKey(install.migration)
  if (!install.terminalRestoreHints.hasInstalledMigration(migrationKey)) {
    try {
      const document = parseHelixdMigrationTerminalRestoreHintsText(decodeUtf8(bytes))
      install.terminalRestoreHints.install(
        { migrationKey, migrationId: install.migration.migrationId },
        placeHints(document.hints, install.paneWorktreeId),
        install.now
      )
    } catch (error) {
      if (!isHintFormatError(error)) {
        throw error
      }
      // Pre-commit validation passed; damaged hints can only fall back to the default folder now.
      console.error(
        `[helixd-migration] dropped unreadable terminal restore hints for ${install.migration.migrationId}:`,
        error
      )
    }
  }
  rmSync(path, { force: true })
  syncDirectoryDurablySync(dirname(path))
}

// Drop hints whose panes have no worktree on this host.
function placeHints(
  hints: readonly HelixdMigrationTerminalRestoreHint[],
  paneWorktreeId: (paneKey: string) => string | null
): HelixdTerminalRestoreHintPlacement[] {
  return hints.flatMap((hint) => {
    const worktreeId = paneWorktreeId(hint.paneKey)
    return worktreeId ? [{ ...hint, worktreeId }] : []
  })
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    throw new Error('helixd_migration_terminal_restore_hints_not_utf8')
  }
}

function isHintFormatError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('helixd_migration_terminal_restore_')
}
