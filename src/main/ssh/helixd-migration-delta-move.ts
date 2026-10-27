/** Journal only additions made after conversion to the same server; retain the full journal chain and source rows. Stage conflicts leave the changed mark and source intact; uncertain outcomes keep the journal for resume. */
import {
  HELIXD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type HelixdMigrationSourceCutover
} from '../../shared/helixd-migration/helixd-migration-source-cutover'
import type { HelixdDeltaMoveResult } from '../../shared/helixd-managed-runtime'
import { recordManagedHelixdMigration } from '../../shared/runtime-environment-managed-helixd-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type { SshTarget } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import {
  abortHelixdMigrationCutover,
  commitHelixdMigrationDestination,
  type HelixdMigrationCutoverContext,
  type HelixdMigrationDestinationCatalog
} from './helixd-migration-cutover-coordinator'
import {
  findHelixdMigrationSourceCutoverForTarget,
  listHelixdMigrationCutoverChainForTarget,
  removeHelixdMigrationSourceCutover,
  writeHelixdMigrationSourceCutover
} from './helixd-migration-cutover-journal'
import {
  committedHelixdMigrationChain,
  helixdDeltaSourceStore,
  planHelixdDeltaMove,
  unfinishedHelixdDelta,
  type HelixdDeltaMovePlan
} from './helixd-migration-delta-plan'
import { assertHelixdMigrationRequestFits } from './helixd-migration-manifest-export'
import { retainHelixdMigrationSource } from './helixd-migration-source-retention'
import {
  assessHelixdMigrationTerminals,
  type HelixdMigrationTerminalVerdict,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './helixd-migration-terminal-gate'
import {
  currentHelixdSourceFingerprint,
  helixdCatalogFingerprint,
  unmovedHelixdSourceRows,
  withKeptHelixdSourceRows
} from './helixd-retained-source'
import { collectHelixdMigrationSourceCatalog } from '../persistence/migrating-helixd-catalog/helixd-source-catalog'
import type { SshTargetHelixdClaims } from './targets/ssh-target-helixd-claims'
import { helixdMigrationRefusalReason } from './helixd-migration-refusal-reason'
import { errorMessage } from '../../shared/error-message'

type HelixdDeltaMoveArgs = {
  userDataPath: string
  store: Store
  claims: SshTargetHelixdClaims
  target: SshTarget
  environment: KnownRuntimeEnvironment
  /** Build the destination after opening its tunnel: re-pairing during open can replace commit credentials. */
  connectDestination: () => Promise<HelixdMigrationDestinationCatalog>
  /** Host census proves exit or identifies terminals preserved by the legacy bridge. */
  censusHost?: CensusHostRelayTerminals | null
  /** Serialize journal-through-commit with all other lifecycle changes to this host. */
  runTargetLifecycle: <T>(targetId: string, operation: () => Promise<T>) => Promise<T>
  now?: () => Date
}

export async function runHelixdDeltaMove(
  args: HelixdDeltaMoveArgs
): Promise<HelixdDeltaMoveResult> {
  const { userDataPath, store, target } = args
  const now = args.now ?? (() => new Date())
  const plan = planHelixdDeltaMove(userDataPath, store, target, { now })
  // Capture baseline with the manifest before awaiting so both describe the same source.
  const planned = currentHelixdSourceFingerprint(store, target)
  if (!plan.resumes && plan.added.length === 0) {
    return refuse('helixd_delta_nothing_new', 'An older build added nothing new to move.')
  }
  if (plan.blockers.length > 0) {
    return {
      ...refuse('helixd_migration_preflight_blocked', helixdMigrationRefusalReason(plan.blockers)),
      blockers: plan.blockers
    }
  }
  if (!plan.resumes) {
    // Reject before journaling or an unsendable delta could pin the fence permanently.
    assertHelixdMigrationRequestFits({ manifest: plan.manifest })
  }
  const terminals = await assessHelixdMigrationTerminals(store, target.id, args.censusHost)
  if (terminals.verdict !== 'exited' && terminals.verdict !== 'bridged') {
    return refuse('helixd_migration_terminals', terminals.reason)
  }
  const settled: SettledTerminals = terminals
  retireProvenExitedLeases(store, target.id, terminals)
  return args.runTargetLifecycle(target.id, async () => {
    // Another move may have journaled or finished while waiting for the lifecycle lock.
    const changedAt = store.getSshTarget(target.id)?.helixdFence?.sourceChangedAt
    const head = findHelixdMigrationSourceCutoverForTarget(userDataPath, target.id)
    if (!changedAt || head?.migrationId !== (plan.resumes ?? plan.head).migrationId) {
      return refuse('helixd_delta_superseded', 'Another move of this host ran first.')
    }
    // Source remains writable before fencing; edits during census must not silently become the manifest's baseline.
    if (!plan.resumes && planned !== currentHelixdSourceFingerprint(store, target)) {
      return refuse(
        'helixd_delta_source_changed',
        'This host changed while the move was starting. Try the move again.'
      )
    }
    const cutover = plan.resumes ?? journalDelta(args, plan, planned, settled, now)
    return commitDelta(args, plan, cutover, changedAt, now)
  })
}

type SettledTerminals = Extract<HelixdMigrationTerminalVerdict, { verdict: 'exited' | 'bridged' }>

function journalDelta(
  args: HelixdDeltaMoveArgs,
  plan: HelixdDeltaMovePlan,
  planned: string,
  terminals: SettledTerminals,
  now: () => Date
): HelixdMigrationSourceCutover {
  const timestamp = now().toISOString()
  const cutover: HelixdMigrationSourceCutover = {
    version: HELIXD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: plan.manifest.migrationId,
    phase: 'source-fenced',
    startedAt: timestamp,
    updatedAt: timestamp,
    destinationEnvironmentId: plan.environmentId,
    destinationName: plan.head.destinationName,
    sshTargetId: args.target.id,
    sshTargetGeneration: plan.head.sshTargetGeneration,
    manifestSha256: plan.manifest.manifestSha256,
    provenPtyIds: terminals.verdict === 'exited' ? terminals.provenPtyIds : [],
    // COMPAT(legacy-relay-bridge): a move leaves relay terminals running for the bridge too.
    ...(terminals.verdict === 'bridged' ? { bridgedPtyIds: terminals.bridgedPtyIds } : {}),
    supersedesMigrationId: plan.head.migrationId,
    // Retained rows must match the whole source captured with this manifest.
    sourceBaselineFingerprint: planned,
    manifest: plan.manifest
  }
  writeHelixdMigrationSourceCutover(args.userDataPath, cutover)
  return cutover
}

async function commitDelta(
  args: HelixdDeltaMoveArgs,
  plan: HelixdDeltaMovePlan,
  cutover: HelixdMigrationSourceCutover,
  changedAt: string,
  now: () => Date
): Promise<HelixdDeltaMoveResult> {
  const { userDataPath, store, target } = args
  // Clear the changed mark and freeze source for the move.
  store.updateSshTarget(target.id, { helixdFence: { environmentId: plan.environmentId } })
  await args.claims.flush()
  // Record before any new/resumed commit so rollback cannot cross the migration.
  recordManagedHelixdMigration(userDataPath, plan.environmentId, now().toISOString())
  let destination: HelixdMigrationDestinationCatalog
  try {
    destination = await args.connectDestination()
  } catch (error) {
    // No request reached the server; keep the journal for later resume.
    await restoreChangedMark(args, cutover, changedAt)
    throw error
  }
  const context: HelixdMigrationCutoverContext = {
    userDataPath,
    store: plan.source,
    freshSource: () => helixdDeltaSourceStore(store, target, plan.moved, cutover.manifest),
    claims: args.claims,
    destination,
    now
  }
  try {
    const committed = await commitHelixdMigrationDestination(context, cutover.migrationId)
    if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
      throw new Error(`helixd_migration_commit_not_proven:${committed.phase}`)
    }
  } catch (error) {
    const released = await releaseUncommittedDelta(args, context, cutover, changedAt)
    if (released === 'released') {
      return refuse('helixd_delta_refused_by_server', errorMessage(error))
    }
    if (released === 'kept') {
      throw error
    }
  }
  await retainHelixdMigrationSource(userDataPath, cutover.migrationId, store, now)
  return { outcome: 'moved', migrationId: cutover.migrationId }
}

/** Release only on proven destination absence; otherwise retain journal for resume. Restore the host's changed mark either way. */
async function releaseUncommittedDelta(
  args: HelixdDeltaMoveArgs,
  context: HelixdMigrationCutoverContext,
  cutover: HelixdMigrationSourceCutover,
  changedAt: string
): Promise<'released' | 'committed' | 'kept'> {
  const restoreMark = (): Promise<void> => restoreChangedMark(args, cutover, changedAt)
  try {
    const result = await abortHelixdMigrationCutover(context, cutover.migrationId, async () => {
      // Restore the mark first so a crash during journal removal leaves a resumable marked host.
      await restoreMark()
      removeHelixdMigrationSourceCutover(args.userDataPath, cutover.migrationId)
    })
    return result.outcome === 'released' ? 'released' : 'committed'
  } catch {
    await restoreMark()
    return 'kept'
  }
}

async function restoreChangedMark(
  args: Pick<HelixdDeltaMoveArgs, 'store' | 'claims'>,
  cutover: HelixdMigrationSourceCutover,
  changedAt: string
): Promise<void> {
  args.store.updateSshTarget(cutover.sshTargetId, {
    helixdFence: { environmentId: cutover.destinationEnvironmentId, sourceChangedAt: changedAt }
  })
  await args.claims.flush()
}

/** Keep older-build changes only in retained profile rows. */
export async function keepHelixdServerVersion(args: {
  userDataPath: string
  store: Store
  claims: SshTargetHelixdClaims
  target: SshTarget
}): Promise<void> {
  const environmentId = args.target.helixdFence?.environmentId
  const chain = listHelixdMigrationCutoverChainForTarget(args.userDataPath, args.target.id)
  if (unfinishedHelixdDelta(chain)) {
    // Unfinished moves may already have copied rows; only commit/abort can decide.
    throw new Error('helixd_delta_move_unfinished')
  }
  const head = committedHelixdMigrationChain(chain).at(-1)
  if (!environmentId || !args.target.helixdFence?.sourceChangedAt || !head) {
    throw new Error('helixd_delta_not_changed')
  }
  const current = collectHelixdMigrationSourceCatalog(args.store, args.target)
  const unmoved = unmovedHelixdSourceRows(current, committedHelixdMigrationChain(chain))
  writeHelixdMigrationSourceCutover(args.userDataPath, {
    ...withKeptHelixdSourceRows(head, unmoved),
    // Explicit reconcile accepts the current retained source as the new baseline.
    sourceBaselineFingerprint: helixdCatalogFingerprint(current)
  })
  args.store.updateSshTarget(args.target.id, { helixdFence: { environmentId } })
  await args.claims.flush()
}

function refuse(
  code: string,
  reason: string
): Extract<HelixdDeltaMoveResult, { outcome: 'refused' }> {
  return { outcome: 'refused', code, reason }
}
