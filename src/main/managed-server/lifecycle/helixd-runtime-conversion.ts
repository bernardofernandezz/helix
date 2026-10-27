// Resume journaled migrations after lost contact; source rows stay authoritative until proven commit.
// Retain source rows afterwards for downgrade compatibility.
import { randomUUID } from 'node:crypto'
import type { HelixdManagedConversionResult } from '../../../shared/helixd-managed-runtime'
import type { HelixdMigrationSourceCutover } from '../../../shared/helixd-migration/helixd-migration-source-cutover'
import { recordManagedHelixdMigration } from '../../../shared/runtime-environment-managed-helixd-store'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import {
  getHelixdSshDeployment,
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { environmentMatchesManagedHelixdCutover } from './helixd-managed-migration-status'
import { requireManagedHelixdInfrastructure } from './helixd-managed-runtime-context'
import { ensureHelixdManagedTunnel } from './helixd-managed-tunnel'
import {
  commitHelixdMigrationDestination,
  type HelixdMigrationDestinationCatalog
} from '../../ssh/helixd-migration-cutover-coordinator'
import {
  findHelixdMigrationSourceCutoverForTarget,
  removeHelixdMigrationJournalsForDestination
} from '../../ssh/helixd-migration-cutover-journal'
import type { SshTarget } from '../../../shared/ssh-types'
import type { CensusHostRelayTerminals } from '../../ssh/helixd-migration-terminal-gate'
import { createManagedHelixdEnvironment } from './helixd-runtime-deployment'
import { createSshRelayMigrationSource } from '../../ssh/helixd-migration-ssh-relay-source'
import {
  leaveBehindClearsHelixdMigrationBlockers,
  onlyLeavableHelixdMigrationBlockers
} from '../../ssh/targets/ssh-target-helixd-preflight'
import { HELIXD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON } from '../../ssh/helixd-migration-source-fence'
import type { HelixdMigrationPaneLeasePredicate } from '../../ssh/helixd-migration-bridged-panes'
import { retainHelixdMigrationSource } from '../../ssh/helixd-migration-source-retention'
import {
  linkedHelixdMigrationCutoverPort,
  linkedHelixdMigrationProjects,
  linkServerHeldRepositories,
  type HelixdServerRepository
} from '../../ssh/helixd-migration-repository-link'
import type { HelixdServerFolderCatalog } from '../../ssh/helixd-server-folder-workspaces'

export type HelixdManagedConversionArgs = {
  sshTargetId: string
  name: string
  censusHost?: ((target: SshTarget) => ReturnType<CensusHostRelayTerminals>) | null
  isBridgedPaneLease?: HelixdMigrationPaneLeasePredicate
  destinationFor: (environment: KnownRuntimeEnvironment) => HelixdMigrationDestinationCatalog
  /** Link matching host paths to existing server projects. */
  serverRepositoriesFor?: (
    environment: KnownRuntimeEnvironment
  ) => Promise<HelixdServerRepository[]>
  /** Link folder workspaces already present from earlier moves. */
  serverFolderCatalogFor?: (
    environment: KnownRuntimeEnvironment
  ) => Promise<HelixdServerFolderCatalog>
  releaseDirectSession?: (sshTargetId: string) => Promise<void>
  now?: () => Date
  signal?: AbortSignal
}

export async function convertSshTargetToManagedHelixd(
  userDataPath: string,
  args: HelixdManagedConversionArgs
): Promise<HelixdManagedConversionResult> {
  const fenced = await fenceOrResume(userDataPath, args)
  if ('outcome' in fenced) {
    return fenced
  }
  const deployed = await createManagedHelixdEnvironment(userDataPath, {
    name: fenced.destinationName,
    sshTargetId: fenced.sshTargetId,
    migration: true,
    signal: args.signal
  })
  if (deployed.outcome === 'deferred') {
    return deployed // Retain fence and journal for a later resume.
  }
  const environment = listEnvironments(userDataPath).find(
    (entry) => entry.id === fenced.destinationEnvironmentId
  )
  if (!environment || !environmentMatchesManagedHelixdCutover(environment, fenced)) {
    throw new Error('helixd_migration_destination_environment_mismatch')
  }
  // Record before commit so crashes cannot allow rollback across migrated state.
  recordManagedHelixdMigration(
    userDataPath,
    environment.id,
    (args.now ?? (() => new Date()))().toISOString()
  )
  // Tunnel repair may replace pairing credentials; use its returned environment for every request.
  const marked = await ensureHelixdManagedTunnel(userDataPath, environment.id)
  const { claims, targetStore } = requireManagedHelixdInfrastructure()
  const store = targetStore.getHelixdMigrationSource()
  const destination = args.destinationFor(marked)
  const serverRepositoriesFor = args.serverRepositoriesFor
  const serverFolderCatalogFor = args.serverFolderCatalogFor
  let linked: Pick<
    HelixdMigrationSourceCutover,
    'linkedRepositoryIds' | 'linkedFolderWorkspaceIds'
  > = {}
  const committed = await runTargetLifecycle(fenced.sshTargetId, async () => {
    const journaled = requireJournaledCutover(userDataPath, fenced)
    const cutover = serverRepositoriesFor
      ? await linkServerHeldRepositories({
          userDataPath,
          store,
          claims,
          cutover: journaled,
          destination,
          serverRepositories: () => serverRepositoriesFor(marked),
          ...(serverFolderCatalogFor
            ? { serverFolderCatalog: () => serverFolderCatalogFor(marked) }
            : {}),
          now: args.now
        })
      : journaled
    linked = cutover
    return commitHelixdMigrationDestination(
      {
        userDataPath,
        store,
        claims,
        source: linkedHelixdMigrationCutoverPort({ userDataPath, store, claims, cutover }),
        destination,
        now: args.now
      },
      cutover.migrationId
    )
  })
  if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
    throw new Error(`helixd_migration_commit_not_proven:${committed.phase}`)
  }
  if (committed.phase === 'destination-committed') {
    await retainHelixdMigrationSource(userDataPath, committed.migrationId, store, args.now)
  }
  const linkedProjects = linkedHelixdMigrationProjects(store, linked)
  return {
    outcome: 'converted',
    environment: redactRuntimeEnvironment(marked),
    migrationId: committed.migrationId,
    ...(linkedProjects.length > 0 ? { linkedProjects } : {})
  }
}

async function fenceOrResume(
  userDataPath: string,
  args: HelixdManagedConversionArgs
): Promise<
  HelixdMigrationSourceCutover | Extract<HelixdManagedConversionResult, { outcome: 'refused' }>
> {
  const { claims, targetStore } = requireManagedHelixdInfrastructure()
  const target = targetStore.getTarget(args.sshTargetId)
  if (!target) {
    return refuse('unverifiable', 'helixd_migration_target_not_found', 'The SSH host is gone.')
  }
  const store = targetStore.getHelixdMigrationSource()
  const censusHost = args.censusHost
  const source = createSshRelayMigrationSource({
    userDataPath,
    store,
    claims,
    target,
    censusHost: censusHost ? () => censusHost(target) : null,
    isBridgedPaneLease: args.isBridgedPaneLease
  })
  const existing = source.resolveFence()
  if (existing.state === 'fenced') {
    return existing.cutover
  }
  const stale = existing.state === 'stale-journal' ? existing.cutover : null
  if (stale && !isRegistered(userDataPath, stale.destinationEnvironmentId)) {
    removeHelixdMigrationJournalsForDestination(
      userDataPath,
      target.id,
      stale.destinationEnvironmentId
    )
  }
  const converted = listEnvironments(userDataPath).some(
    (environment) => getHelixdSshDeployment(environment)?.sshTargetId === target.id
  )
  if (converted) {
    return refuse(
      'live',
      'helixd_migration_already_managed',
      'Helix already runs on this SSH host.'
    )
  }
  // Source fencing rechecks leases after acquisition.
  const terminalProof = await source.assessTerminals()
  if (terminalProof.verdict === 'live' || terminalProof.verdict === 'unverifiable') {
    return refuse(terminalProof.verdict, 'helixd_migration_terminals', terminalProof.reason)
  }
  source.retireProvenExitedTerminals(terminalProof)
  await args.releaseDirectSession?.(target.id)
  const result = await runTargetLifecycle(target.id, () =>
    source.acquireFence({
      destinationEnvironmentId: randomUUID(),
      destinationName: args.name,
      terminalProof,
      now: args.now,
      signal: args.signal
    })
  )
  if (result.outcome === 'fenced') {
    return result.cutover
  }
  if (result.blockers?.length) {
    // Surface blocked state in logs because connect shows only the summary reason.
    console.warn(
      '[ssh] Conversion refused by:',
      JSON.stringify(
        result.blockers.map((blocker) =>
          'dependencies' in blocker
            ? { code: blocker.code, dependencies: blocker.dependencies }
            : { code: blocker.code }
        )
      )
    )
  }
  const leavable =
    result.blockers &&
    onlyLeavableHelixdMigrationBlockers(result.blockers) &&
    !target.managedServerLeaveBehind
  const canLeaveBehind =
    leavable &&
    leaveBehindClearsHelixdMigrationBlockers(
      store,
      target.id,
      terminalProof.verdict === 'bridged' ? terminalProof.bridgedPtyIds : [],
      args.isBridgedPaneLease
    )
  if (leavable && terminalProof.verdict !== 'exited' && !canLeaveBehind) {
    // Leaving tabs behind would strand terminals still served by the legacy bridge.
    return refuse(
      result.verdict,
      result.code,
      `${result.reason} ${HELIXD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON}`
    )
  }
  return {
    ...refuse(result.verdict, result.code, result.reason),
    // Preview confirmation to avoid offering an export the confirmed path would refuse.
    ...(canLeaveBehind ? { canLeaveBehind: true } : {})
  }
}

function requireJournaledCutover(
  userDataPath: string,
  fenced: HelixdMigrationSourceCutover
): HelixdMigrationSourceCutover {
  const journaled = findHelixdMigrationSourceCutoverForTarget(userDataPath, fenced.sshTargetId)
  if (journaled?.migrationId !== fenced.migrationId) {
    throw new Error('helixd_migration_source_fence_lost')
  }
  return journaled
}

function isRegistered(userDataPath: string, environmentId: string): boolean {
  return listEnvironments(userDataPath).some((environment) => environment.id === environmentId)
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<HelixdManagedConversionResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
