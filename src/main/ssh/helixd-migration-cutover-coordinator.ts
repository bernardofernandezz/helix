/** Keep source authority until durable destination commit. Verify the fenced export before stage/commit; resolve lost replies by catalog reads and persist journal transitions before returning. Never release a committed destination. */
import type {
  HelixdMigrationCatalogAbortResult,
  HelixdMigrationCatalogReferenceAbortResult,
  HelixdMigrationCatalogState,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'
import type {
  HelixdMigrationSnapshotChunkRequest,
  HelixdMigrationSnapshotChunkResult
} from '../../shared/helixd-migration/helixd-migration-scrollback'
import type {
  HelixdMigrationSourceCutover,
  HelixdMigrationSourceCutoverPhase
} from '../../shared/helixd-migration/helixd-migration-source-cutover'
import { resolveDurableHelixdCatalogMutation } from './helixd-catalog-durable-mutation'
import { HELIXD_MIGRATION_DESTINATION_UNSUPPORTED } from './helixd-migration-catalog-client'
import { helixdMigrationRequestFits } from './helixd-migration-manifest-export'
import {
  listHelixdMigrationSourceCutovers,
  writeHelixdMigrationSourceCutover
} from './helixd-migration-cutover-journal'
import type { HelixdMigrationSourceCutoverPort } from './helixd-migration-source'
import {
  transferHelixdMigrationSnapshots,
  type HelixdMigrationSnapshotSource
} from './helixd-migration-snapshot-coordinator'
import type { HelixdMigrationPreflightStore } from './targets/ssh-target-helixd-preflight'
import { sshRelayMigrationCutoverPort } from './helixd-migration-ssh-relay-source'
import type { SshTargetHelixdClaims } from './targets/ssh-target-helixd-claims'

export type HelixdMigrationDestinationCatalog = {
  readState: (manifest: HelixdMigrationManifest) => Promise<HelixdMigrationCatalogState>
  stage: (manifest: HelixdMigrationManifest) => Promise<HelixdMigrationCatalogState>
  commit: (manifest: HelixdMigrationManifest) => Promise<HelixdMigrationCatalogState>
  abort: (manifest: HelixdMigrationManifest) => Promise<HelixdMigrationCatalogAbortResult>
  /** Use identity-only abort when the journal's full manifest cannot fit a request. */
  abortByReference: (
    manifest: HelixdMigrationManifest
  ) => Promise<HelixdMigrationCatalogReferenceAbortResult>
  stageChunk: (
    request: HelixdMigrationSnapshotChunkRequest
  ) => Promise<HelixdMigrationSnapshotChunkResult>
}

export type HelixdMigrationCutoverContext = {
  userDataPath: string
  store: HelixdMigrationPreflightStore & HelixdMigrationSnapshotSource
  claims: SshTargetHelixdClaims
  destination: HelixdMigrationDestinationCatalog
  /** Rebuild copied stores for each check so concurrent edits remain visible. */
  freshSource?: () => HelixdMigrationPreflightStore
  /** The fenced source; defaults to the relay-era SSH target the journal names. */
  source?: HelixdMigrationSourceCutoverPort
  now?: () => Date
}

function cutoverSource(context: HelixdMigrationCutoverContext): HelixdMigrationSourceCutoverPort {
  return context.source ?? sshRelayMigrationCutoverPort(context)
}

export async function stageHelixdMigrationDestination(
  context: HelixdMigrationCutoverContext,
  migrationId: string
): Promise<HelixdMigrationSourceCutover> {
  let cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return cutover
  }
  assertSourceUnchanged(context, cutover)
  const { destination } = context
  const read = await destination.readState(cutover.manifest)
  const state =
    read.state === 'committed'
      ? await confirmDurableCommit(destination, cutover.manifest)
      : await resolveDurableHelixdCatalogMutation(
          () => destination.stage(cutover.manifest),
          () => destination.readState(cutover.manifest),
          (observed) => observed.state !== 'absent'
        )
  cutover = recordObservedState(context, cutover, state)
  if (state.state === 'staged') {
    await transferHelixdMigrationSnapshots({
      source: context.store,
      manifest: cutover.manifest,
      state,
      destination: { readState: destination.readState, stageChunk: destination.stageChunk }
    })
  }
  return cutover
}

export async function commitHelixdMigrationDestination(
  context: HelixdMigrationCutoverContext,
  migrationId: string
): Promise<HelixdMigrationSourceCutover> {
  const staged = await stageHelixdMigrationDestination(context, migrationId)
  if (staged.phase !== 'destination-staged') {
    return staged
  }
  assertSourceUnchanged(context, staged)
  const { destination } = context
  // A lost commit reply may hide success; catalog read decides the next step.
  const state = await resolveDurableHelixdCatalogMutation(
    () => destination.commit(staged.manifest),
    () => destination.readState(staged.manifest),
    (observed) => observed.state === 'committed'
  )
  if (state.state !== 'committed') {
    throw new Error(`helixd_migration_commit_not_committed:${state.state}`)
  }
  return recordObservedState(context, staged, state)
}

export type HelixdMigrationAbortResult =
  | { outcome: 'released'; evidence: 'catalog-absent' | 'destination-unsupported' }
  | { outcome: 'refused'; code: string; reason: string }

/** Release only on proven destination absence; default drops journal/fence, while delta moves retain the fence. */
export async function abortHelixdMigrationCutover(
  context: HelixdMigrationCutoverContext,
  migrationId: string,
  release: (cutover: HelixdMigrationSourceCutover) => Promise<void> = (cutover) =>
    cutoverSource(context).releaseFence(cutover)
): Promise<HelixdMigrationAbortResult> {
  const cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return committedRefusal()
  }
  const { destination } = context
  // Older journals can hold oversized manifests; identity-only abort must still release them.
  if (!helixdMigrationRequestFits({ manifest: cutover.manifest })) {
    const aborted = await destination.abortByReference(cutover.manifest)
    if (aborted.state === 'committed') {
      return committedRefusal()
    }
    await release(cutover)
    return { outcome: 'released', evidence: 'catalog-absent' }
  }
  let state: HelixdMigrationCatalogState
  try {
    state = await destination.readState(cutover.manifest)
  } catch (error) {
    // Unsupported proves absence only before any stage could have landed.
    if (isDestinationUnsupported(error) && cutover.phase === 'source-fenced') {
      await release(cutover)
      return { outcome: 'released', evidence: 'destination-unsupported' }
    }
    throw error
  }
  if (state.state !== 'committed') {
    state = await abortWithRecovery(destination, cutover.manifest)
  }
  if (state.state === 'committed') {
    recordObservedState(context, cutover, await confirmDurableCommit(destination, cutover.manifest))
    return committedRefusal()
  }
  if (state.state !== 'absent') {
    throw new Error(`helixd_migration_abort_not_absent:${state.state}`)
  }
  await release(cutover)
  return { outcome: 'released', evidence: 'catalog-absent' }
}

/** Committed reads may be unflushed memory; require the idempotent commit acknowledgement to prove durability. */
async function confirmDurableCommit(
  destination: HelixdMigrationDestinationCatalog,
  manifest: HelixdMigrationManifest
): Promise<HelixdMigrationCatalogState> {
  const state = await destination.commit(manifest)
  if (state.state !== 'committed') {
    throw new Error(`helixd_migration_commit_not_committed:${state.state}`)
  }
  return state
}

function assertSourceUnchanged(
  context: HelixdMigrationCutoverContext,
  cutover: HelixdMigrationSourceCutover
): void {
  cutoverSource(context).verifyFence(cutover)
}

/** Persist observed state before returning. */
function recordObservedState(
  context: HelixdMigrationCutoverContext,
  cutover: HelixdMigrationSourceCutover,
  state: HelixdMigrationCatalogState
): HelixdMigrationSourceCutover {
  if (state.state === 'absent') {
    throw new Error('helixd_migration_destination_catalog_absent')
  }
  if (
    state.migrationId !== cutover.migrationId ||
    state.manifestSha256 !== cutover.manifestSha256
  ) {
    throw new Error('helixd_migration_destination_state_mismatch')
  }
  if (
    state.state === 'committed' &&
    (state.receipt.migrationId !== cutover.migrationId ||
      state.receipt.manifestSha256 !== cutover.manifestSha256)
  ) {
    throw new Error('helixd_migration_destination_receipt_mismatch')
  }
  const phase: HelixdMigrationSourceCutoverPhase =
    state.state === 'committed' ? 'destination-committed' : 'destination-staged'
  if (phase === cutover.phase) {
    return cutover
  }
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    // Never regress a proven commit.
    return cutover
  }
  const next: HelixdMigrationSourceCutover = {
    ...cutover,
    phase,
    updatedAt: (context.now ?? (() => new Date()))().toISOString()
  }
  writeHelixdMigrationSourceCutover(context.userDataPath, next)
  return next
}

async function abortWithRecovery(
  destination: HelixdMigrationDestinationCatalog,
  manifest: HelixdMigrationManifest
): Promise<HelixdMigrationCatalogState> {
  try {
    return await destination.abort(manifest)
  } catch (abortError) {
    try {
      const observed = await destination.readState(manifest)
      if (observed.state === 'committed') {
        return observed
      }
      if (observed.state === 'absent') {
        // Absent reads may predate flush; repeat abort to prove durable absence.
        return await destination.abort(manifest)
      }
    } catch {
      // Keep the original failure and fence while abort remains unverifiable.
    }
    throw abortError
  }
}

function requireCutover(userDataPath: string, migrationId: string): HelixdMigrationSourceCutover {
  const cutover = listHelixdMigrationSourceCutovers(userDataPath).find(
    (entry) => entry.migrationId === migrationId
  )
  if (!cutover) {
    throw new Error('helixd_migration_source_cutover_not_found')
  }
  return cutover
}

function committedRefusal(): HelixdMigrationAbortResult {
  return {
    outcome: 'refused',
    code: 'helixd_migration_committed_source_cannot_be_released',
    reason: 'This host’s Helix server already holds this migration; it can only move forward.'
  }
}

function isDestinationUnsupported(error: unknown): boolean {
  return error instanceof Error && error.message === HELIXD_MIGRATION_DESTINATION_UNSUPPORTED
}
