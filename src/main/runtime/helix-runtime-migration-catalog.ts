import type {
  HelixdMigrationCatalogAbortResult,
  HelixdMigrationCatalogReference,
  HelixdMigrationCatalogReferenceAbortResult,
  HelixdMigrationCatalogState,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'
import type {
  HelixdMigrationSnapshotChunkRequest,
  HelixdMigrationSnapshotChunkResult
} from '../../shared/helixd-migration/helixd-migration-scrollback'
import type {
  HelixdMigrationBlobChunkRequest,
  HelixdMigrationBlobChunkResult,
  HelixdMigrationBlobDescriptor
} from '../../shared/helixd-migration/helixd-migration-blob-transfer'
import {
  abortStagedHelixdMigrationCatalogByReferenceDurably,
  abortStagedHelixdMigrationCatalogDurably,
  commitStagedHelixdMigrationCatalogDurably,
  getHelixdMigrationCatalogState,
  stageHelixdMigrationCatalogDurably
} from './helixd-migration-catalog-import'
import { HelixRuntimeWithResolveWaiter } from './helix-runtime-resolve-waiter'
import type { RuntimeStore } from './runtime-store-contract'

type MigrationStoreKey =
  | 'stageHelixdMigrationCatalog'
  | 'commitStagedHelixdMigrationCatalog'
  | 'stageHelixdMigrationSnapshotChunk'
  | 'stageHelixdMigrationBlobChunk'
  | 'abortStagedHelixdMigrationCatalog'
  | 'abortStagedHelixdMigrationCatalogByReference'
  | 'getHelixdMigrationCatalogState'
  | 'flushPendingOrThrowAsync'

/** The destination half of a dormant catalog migration; every mutation is flushed before it answers. */
export abstract class HelixRuntimeWithMigrationCatalog extends HelixRuntimeWithResolveWaiter {
  async stageHelixdMigrationCatalog(
    manifest: HelixdMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<HelixdMigrationCatalogState> {
    return stageHelixdMigrationCatalogDurably({
      store: this.requireMigrationStore('stageHelixdMigrationCatalog', 'flushPendingOrThrowAsync'),
      manifest,
      signal: options.signal
    })
  }

  async commitStagedHelixdMigrationCatalog(
    manifest: HelixdMigrationManifest,
    options: { signal?: AbortSignal; expectedBlobs?: readonly HelixdMigrationBlobDescriptor[] } = {}
  ): Promise<HelixdMigrationCatalogState> {
    return commitStagedHelixdMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'commitStagedHelixdMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal,
      expectedBlobs: options.expectedBlobs,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells,
      onDurableCommit: () => {
        this.invalidateResolvedWorktreeCache()
        this.notifyReposChanged()
      }
    })
  }

  stageHelixdMigrationSnapshotChunk(
    request: HelixdMigrationSnapshotChunkRequest
  ): HelixdMigrationSnapshotChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageHelixdMigrationSnapshotChunk')
      .stageHelixdMigrationSnapshotChunk!(request)
  }

  stageHelixdMigrationBlobChunk(
    request: HelixdMigrationBlobChunkRequest
  ): HelixdMigrationBlobChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageHelixdMigrationBlobChunk')
      .stageHelixdMigrationBlobChunk!(request)
  }

  async abortStagedHelixdMigrationCatalog(
    manifest: HelixdMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<HelixdMigrationCatalogAbortResult> {
    return abortStagedHelixdMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'abortStagedHelixdMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal
    })
  }

  async abortStagedHelixdMigrationCatalogByReference(
    reference: HelixdMigrationCatalogReference,
    options: { signal?: AbortSignal } = {}
  ): Promise<HelixdMigrationCatalogReferenceAbortResult> {
    return abortStagedHelixdMigrationCatalogByReferenceDurably({
      store: this.requireMigrationStore(
        'abortStagedHelixdMigrationCatalogByReference',
        'flushPendingOrThrowAsync'
      ),
      reference,
      signal: options.signal
    })
  }

  getHelixdMigrationCatalogState(manifest: HelixdMigrationManifest): HelixdMigrationCatalogState {
    return getHelixdMigrationCatalogState({
      store: this.requireMigrationStore('getHelixdMigrationCatalogState'),
      manifest,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  /** Install deferred migrated history after host-shell discovery; unanswered inventory retries on the next catalog query. */
  async installPendingHelixdMigrationShellHistory(): Promise<void> {
    const store = this.store
    // Every daemon start calls this; no pending blobs must cost no inventory.
    if (
      !store?.installPendingHelixdMigrationReceivedBlobs ||
      !store.hasPendingHelixdMigrationShellHistory?.()
    ) {
      return
    }
    // Inventory first to find restart-surviving shells; real worktrees preserve their restored orchestration receipts.
    if (
      this.ptyController?.listProcesses &&
      !(await this.refreshPtyWorktreeRecordsWithControllerInventory([
        ...(await this.getResolvedWorktreeMap()).values()
      ]))
    ) {
      console.warn('[helixd-migration] shell history waits: the terminal inventory did not answer')
      return
    }
    store.installPendingHelixdMigrationReceivedBlobs({
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  override onPtyExit(
    ...args: Parameters<HelixRuntimeWithResolveWaiter['onPtyExit']>
  ): ReturnType<HelixRuntimeWithResolveWaiter['onPtyExit']> {
    const worktreeId = this.ptysById.get(args[0])?.worktreeId
    const result = super.onPtyExit(...args)
    if (worktreeId) {
      try {
        this.store?.installDeferredHelixdMigrationShellHistory?.(worktreeId, {
          worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
        })
      } catch (error) {
        console.error('[helixd-migration] installing deferred shell history failed:', error)
      }
    }
    return result
  }

  // Migrated history belongs here; same-id SSH twins never write it.
  private readonly migrationWorktreeHasLiveShells = (worktreeId: string): boolean =>
    this.getLivePtyIdsForWorktree(worktreeId, undefined, { resolvedConnectionId: null }).size > 0

  // Check the captured Store, not a potentially different virtual return.
  private requireMigrationStore(...methods: MigrationStoreKey[]): RuntimeStore {
    const store = this.store
    if (!store || methods.some((method) => typeof store[method] !== 'function')) {
      throw new Error('runtime_unavailable')
    }
    return this.requireStore()
  }
}
