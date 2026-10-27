import type {
  HelixdMigrationCatalogAbortResult,
  HelixdMigrationCatalogReference,
  HelixdMigrationCatalogReferenceAbortResult,
  HelixdMigrationCatalogState,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'
import type { HelixdMigrationBlobDescriptor } from '../../shared/helixd-migration/helixd-migration-blob-transfer'
import type { Store } from '../persistence'

/** A moved history waits while a shell runs in its worktree: that shell would overwrite it. */
type WorktreeHasLiveShells = (worktreeId: string) => boolean

type HelixdMigrationCatalogFlushStore = Partial<Pick<Store, 'flushPendingOrThrowAsync'>>
type HelixdMigrationCatalogStageStore = HelixdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'stageHelixdMigrationCatalog'>>
type HelixdMigrationCatalogCommitStore = HelixdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'commitStagedHelixdMigrationCatalog' | 'installHelixdMigrationReceivedBlobs'>>
type HelixdMigrationCatalogAbortStore = HelixdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedHelixdMigrationCatalog'>>
type HelixdMigrationCatalogAbortByReferenceStore = HelixdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedHelixdMigrationCatalogByReference'>>

export async function stageHelixdMigrationCatalogDurably(args: {
  store: HelixdMigrationCatalogStageStore
  manifest: HelixdMigrationManifest
  signal?: AbortSignal
}): Promise<HelixdMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.stageHelixdMigrationCatalog!(args.manifest)
  await flushMigrationState(args.store, args.signal)
  return result
}

export async function commitStagedHelixdMigrationCatalogDurably(args: {
  store: HelixdMigrationCatalogCommitStore
  manifest: HelixdMigrationManifest
  signal?: AbortSignal
  expectedBlobs?: readonly HelixdMigrationBlobDescriptor[]
  onDurableCommit: () => void
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): Promise<HelixdMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.commitStagedHelixdMigrationCatalog!(
    args.manifest,
    args.expectedBlobs ? { expectedBlobs: args.expectedBlobs } : {}
  )
  await flushMigrationState(args.store, args.signal)
  args.onDurableCommit()
  installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  return result
}

/** After the durable commit, on its retries and state queries; the store load retries too. */
function installReceivedBlobs(
  store: Partial<Pick<Store, 'installHelixdMigrationReceivedBlobs'>>,
  manifest: HelixdMigrationManifest,
  worktreeHasLiveShells: WorktreeHasLiveShells | undefined
): void {
  try {
    store.installHelixdMigrationReceivedBlobs?.(manifest, { worktreeHasLiveShells })
  } catch (error) {
    // The catalog is committed; a failed install keeps its blob for the next retry.
    console.error('[helixd-migration] installing received blobs failed:', error)
  }
}

export async function abortStagedHelixdMigrationCatalogDurably(args: {
  store: HelixdMigrationCatalogAbortStore
  manifest: HelixdMigrationManifest
  signal?: AbortSignal
}): Promise<HelixdMigrationCatalogAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedHelixdMigrationCatalog!(args.manifest)
  // An already-absent retry may follow an in-memory abort whose flush failed.
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export async function abortStagedHelixdMigrationCatalogByReferenceDurably(args: {
  store: HelixdMigrationCatalogAbortByReferenceStore
  reference: HelixdMigrationCatalogReference
  signal?: AbortSignal
}): Promise<HelixdMigrationCatalogReferenceAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedHelixdMigrationCatalogByReference!(args.reference)
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export function getHelixdMigrationCatalogState(args: {
  store: Partial<
    Pick<Store, 'getHelixdMigrationCatalogState' | 'installHelixdMigrationReceivedBlobs'>
  >
  manifest: HelixdMigrationManifest
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): HelixdMigrationCatalogState {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.getHelixdMigrationCatalogState!(args.manifest)
  if (result.state === 'committed') {
    installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  }
  return result
}

function flushMigrationState(
  store: HelixdMigrationCatalogFlushStore,
  signal?: AbortSignal
): Promise<void> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  return store.flushPendingOrThrowAsync!({
    signal,
    drainToStableGeneration: false
  })
}
