import { HELIXD_MIGRATION_BLOB_KIND_CONTRACTS } from '../../../shared/helixd-migration/helixd-migration-blob-transfer'
import type { HelixdMigrationManifest } from '../../../shared/helixd-migration/helixd-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { getHistoryRoot } from '../../terminal-history-paths'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  findHelixdMigrationImportReceipt,
  isHelixdMigrationCommitDurable
} from './helixd-catalog-receipt-ledger'
import { installHelixdMigrationReceivedBlobs } from './helixd-migration-blob-installers'
import { listHelixdMigrationReceivedBlobNames } from './helixd-migration-blob-staging'
import type { HelixdMigrationRequestIdentity } from './helixd-migration-staged-file'

type HelixdMigrationBlobInstallRuntime = Pick<
  StoreRuntimeState,
  | 'state'
  | 'helixdMigrationBlobRoot'
  | 'helixdTerminalRestoreHints'
  | 'paneShellPath'
  | 'deferredShellHistoryWorktreeIds'
  | 'writeGeneration'
  | 'lastDurableWriteGeneration'
  | 'helixdMigrationCommitWriteGenerations'
>

type ClockOptions = { now?: () => Date }
type InstallOptions = ClockOptions & {
  /** Defer history installation while shells run in its worktree. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
}

const helixdMigrationBlobInstallContext = Symbol('HelixdMigrationBlobInstallPersistence')
type HelixdMigrationBlobInstallContext = {
  runtime: HelixdMigrationBlobInstallRuntime
}

export class HelixdMigrationBlobInstallPersistence {
  readonly [helixdMigrationBlobInstallContext]: HelixdMigrationBlobInstallContext

  constructor(runtime: HelixdMigrationBlobInstallRuntime) {
    this[helixdMigrationBlobInstallContext] = { runtime }
  }

  /** Wait for durable commit or a restart could lose both the catalog and its consumed blobs. */
  installHelixdMigrationReceivedBlobs(
    manifest: HelixdMigrationManifest,
    options: InstallOptions = {}
  ): void {
    const receipt = findHelixdMigrationImportReceipt(
      this[helixdMigrationBlobInstallContext].runtime.state,
      manifest
    )
    if (receipt?.manifestSha256 !== manifest.manifestSha256) {
      return
    }
    installCommitted(this[helixdMigrationBlobInstallContext].runtime, manifest, options)
  }

  /** Recover interrupted installs; disk-loaded receipts already prove durability. */
  installPendingHelixdMigrationReceivedBlobs(options: InstallOptions = {}): void {
    const { runtime } = this[helixdMigrationBlobInstallContext]
    for (const receipt of [
      ...(runtime.state.helixdMigrationImportReceipts ?? []),
      ...(runtime.state.helixdMigrationEvictedReceipts ?? [])
    ]) {
      try {
        installCommitted(runtime, receipt, options)
      } catch (error) {
        console.error(
          `[helixd-migration] installing received blobs for ${receipt.migrationId} failed:`,
          error
        )
      }
    }
  }

  /** Only the runtime installs pending shell history. */
  hasPendingHelixdMigrationShellHistory(): boolean {
    const { runtime } = this[helixdMigrationBlobInstallContext]
    return [
      ...(runtime.state.helixdMigrationImportReceipts ?? []),
      ...(runtime.state.helixdMigrationEvictedReceipts ?? [])
    ].some((receipt) =>
      listHelixdMigrationReceivedBlobNames(
        runtime.helixdMigrationBlobRoot,
        receipt,
        'shell-history'
      ).some((key) => HELIXD_MIGRATION_BLOB_KIND_CONTRACTS['shell-history'].key.test(key))
    )
  }

  installDeferredHelixdMigrationShellHistory(
    worktreeId: string,
    options: InstallOptions = {}
  ): void {
    const { runtime } = this[helixdMigrationBlobInstallContext]
    if (runtime.deferredShellHistoryWorktreeIds.has(worktreeId)) {
      this.installPendingHelixdMigrationReceivedBlobs(options)
    }
  }

  /** Read without consuming. */
  peekHelixdMigrationTerminalRestoreHint(
    paneKey: string,
    worktreeId: string,
    options: ClockOptions = {}
  ): string | null {
    return this[helixdMigrationBlobInstallContext].runtime.helixdTerminalRestoreHints.peek(
      paneKey,
      worktreeId,
      clock(options)
    )
  }

  /** Consume after spawn, even if it used a different cwd. */
  consumeHelixdMigrationTerminalRestoreHint(paneKey: string, options: ClockOptions = {}): void {
    this[helixdMigrationBlobInstallContext].runtime.helixdTerminalRestoreHints.consume(
      paneKey,
      clock(options)
    )
  }
}

function installCommitted(
  runtime: HelixdMigrationBlobInstallRuntime,
  migration: HelixdMigrationRequestIdentity,
  options: InstallOptions
): void {
  if (!isHelixdMigrationCommitDurable(runtime, migration)) {
    return
  }
  installHelixdMigrationReceivedBlobs({
    migration,
    root: runtime.helixdMigrationBlobRoot,
    terminalRestoreHints: runtime.helixdTerminalRestoreHints,
    shellHistoryRoot: getHistoryRoot(),
    paneShellPath: () => runtime.paneShellPath(runtime.state.settings?.terminalDefaultShell),
    worktreeHasLiveShells: options.worktreeHasLiveShells,
    deferredShellHistoryWorktreeIds: runtime.deferredShellHistoryWorktreeIds,
    paneWorktreeId: (paneKey) => findPaneWorktreeId(runtime.state, paneKey),
    now: clock(options)
  })
}

function clock(options: ClockOptions): number {
  return (options.now ?? (() => new Date()))().getTime()
}

function findPaneWorktreeId(state: PersistedState, paneKey: string): string | null {
  const tabId = parsePaneKey(paneKey)?.tabId
  if (!tabId) {
    return null
  }
  const sessions = [state.workspaceSession, ...Object.values(state.workspaceSessionsByHostId ?? {})]
  for (const session of sessions) {
    for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
      if (tabs.some((tab) => tab.id === tabId)) {
        return worktreeId
      }
    }
  }
  return null
}
