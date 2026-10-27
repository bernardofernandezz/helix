/** Census through the managed tunnel before lifecycle changes. Unknown counts never mean zero, so live/uncounted hosts defer update (D7). */
import { getAppEnvironment } from '../../shared/app-environment'
import { assertRuntimeEnvironmentNotReconciling } from '../../shared/runtime-environment-reconciliation-record'
import {
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import type {
  HelixdManagedDeployResult,
  HelixdManagedPastLiveTerminals,
  HelixdManagedRecoveryResult,
  HelixdManagedRollbackResult
} from '../../shared/helixd-managed-runtime'
import { runTargetLifecycle } from '../ipc/ssh/ssh-target-lifecycle-queue'
import { recoverInterruptedHelixdActivation } from '../managed-server/activation/helixd-activation-recovery'
import { probeActiveHelixdReadiness } from './helixd-active-readiness'
import { materializeHelixdArtifact } from '../helixd/helixd-artifact-materializer'
import { CURRENT_HELIXD_DAEMON_PROTOCOL } from './helixd-daemon-protocol-crossing'
import { rebuildHelixdManagedTunnel } from '../managed-server/lifecycle/helixd-managed-tunnel'
import { wakeAlreadyActiveHelixd } from './helixd-already-active-wake'
import {
  clearManagedHelixdUpdateDeferral,
  recordManagedHelixdUpdateDeferral
} from '../managed-server/lifecycle/helixd-managed-update-deferrals'
import {
  isForceableHelixdDeferral,
  managedHelixdInstallDir,
  managedHelixdSlot,
  probeManagedHelixdReadiness,
  requireManagedHelixdEnvironment,
  resolveLinkedHelixdContext
} from '../managed-server/lifecycle/helixd-managed-runtime-context'
import type { HelixdRemoteContext } from '../managed-server/install/helixd-remote-context'
import { readRemoteHelixdBuildHash } from '../managed-server/install/helixd-remote-build-hash'
import { deployHelixd, type HelixdDeployOptions } from './helixd-remote-deploy'
import type { HelixdUpdateForce } from './helixd-update-plan'
import { HELIXD_ACTIVATION_POLICY_REFUSED_CODE } from './helixd-installed-activation'
import { pruneManagedHelixdVersions } from '../managed-server/lifecycle/helixd-managed-version-gc'
import { clearHelixdUpdateFailedThisLaunch } from '../managed-server/lifecycle/helixd-managed-update-failure-memory'
import { admitHelixdRecordForIntent } from '../managed-server/lifecycle/helixd-managed-update-decision'
import { rollbackHelixd } from '../managed-server/install/helixd-remote-rollback'
import { collectManagedTerminalCensus } from './helixd-terminal-census-client'
import { updateTerminalCounts } from './helixd-fenced-stop'
import { findIncompleteManagedHelixdMigration } from '../managed-server/lifecycle/helixd-managed-migration-status'
import { latestHelixdMigrationInto } from './helixd-migration-rollback-mark'
import { refreshMaintainedHelixdPairing } from './helixd-maintenance-pairing-refresh'

type LifecycleArgs = { selector: string; signal?: AbortSignal }

export function withManagedHelixdLifecycle<T>(
  userDataPath: string,
  selector: string,
  run: (managed: ReturnType<typeof requireManagedHelixdEnvironment>) => Promise<T>
): Promise<T> {
  const { environment, deployment } = requireManagedHelixdEnvironment(userDataPath, selector)
  return runTargetLifecycle(deployment.sshTargetId, async () => {
    // Re-read in the lifecycle queue because reconciliation/stop may have won first.
    const current = requireManagedHelixdEnvironment(userDataPath, environment.id)
    assertRuntimeEnvironmentNotReconciling(current.environment)
    return run(current)
  })
}

/** Rebuild forwarding when a launched slot binds a different port. */
export async function followLaunchedServerPort(
  userDataPath: string,
  environmentId: string
): Promise<void> {
  try {
    await rebuildHelixdManagedTunnel(userDataPath, environmentId)
  } catch (error) {
    // Server already launched; if tunnel rebuild fails, the next connect can forward its bound port.
    console.warn('[ssh] Could not forward to the relaunched managed Helix server:', error)
  }
}

export function updateManagedHelixdEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { force?: boolean; pastLiveTerminals?: HelixdManagedPastLiveTerminals }
): Promise<HelixdManagedDeployResult> {
  const { pastLiveTerminals } = args
  // Update anyway keeps Update's version admission even if a caller also passed force.
  const intent = args.force && !pastLiveTerminals ? 'force' : 'update'
  return withManagedHelixdLifecycle(userDataPath, args.selector, async (managed) => {
    const admitIntent = admitHelixdRecordForIntent(intent, getAppEnvironment().getVersion())
    // Checked under the host fence: another desktop may have activated a build since the confirm.
    const admitRecord: NonNullable<HelixdDeployOptions['admitRecord']> = pastLiveTerminals
      ? (record, candidateVersion) =>
          record.active !== pastLiveTerminals.incumbentVersion
            ? "This host's server changed since the update was confirmed. Review it and update again."
            : admitIntent(record, candidateVersion)
      : admitIntent
    const force: HelixdUpdateForce | undefined = pastLiveTerminals ? 'live-terminals' : args.force
    const result = await runManagedHelixdUpdate(
      userDataPath,
      managed,
      await resolveLinkedHelixdContext(managed.environment, managed.deployment, args.signal),
      { signal: args.signal, force, admitRecord }
    )
    // A completed manual update clears automatic failure suppression; deferred attempts do not.
    if (result.outcome !== 'deferred') {
      clearHelixdUpdateFailedThisLaunch({ kind: 'ssh', id: managed.deployment.sshTargetId })
    }
    return result
  })
}

export async function runManagedHelixdUpdate(
  userDataPath: string,
  { environment, deployment }: ReturnType<typeof requireManagedHelixdEnvironment>,
  context: HelixdRemoteContext,
  args: {
    force?: HelixdUpdateForce
    signal?: AbortSignal
    localHelixdDir?: string
    admitRecord?: HelixdDeployOptions['admitRecord']
  }
): Promise<HelixdManagedDeployResult> {
  const { countFirst, ...recount } = updateTerminalCounts((options) =>
    collectManagedTerminalCensus(
      userDataPath,
      environment,
      context.activationRecord,
      undefined,
      options
    )
  )
  const census = await countFirst()
  const localHelixdDir =
    args.localHelixdDir ??
    (await materializeHelixdArtifact(context.serverTarget, { signal: args.signal }))
  const slot = managedHelixdSlot(context, deployment.remotePort, args.signal)
  const result = await deployHelixd({
    ...slot,
    localHelixdDir,
    target: context.serverTarget,
    census,
    ...recount,
    censusRecord: context.activationRecord,
    force: args.force,
    appVersion: getAppEnvironment().getVersion(),
    ...(args.admitRecord ? { admitRecord: args.admitRecord } : {})
  })
  if (result.outcome === 'installed-not-activated') {
    const deferral = {
      outcome: 'deferred' as const,
      candidateVersion: result.fullVersion,
      code: result.code,
      reason: result.reason,
      // Force may override policy deferrals, including a newer host build.
      forceable:
        isForceableHelixdDeferral(result.code) ||
        result.code === HELIXD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Policy refusal is final for this host, not a transient update to retry.
    if (result.code !== HELIXD_ACTIVATION_POLICY_REFUSED_CODE) {
      recordManagedHelixdUpdateDeferral(environment.id, deferral)
    }
    return deferral
  }
  clearManagedHelixdUpdateDeferral(environment.id)
  const started = result.outcome === 'already-active' && (await wakeAlreadyActiveHelixd(slot))
  const readiness = await probeManagedHelixdReadiness(
    context,
    localHelixdDir,
    result.fullVersion,
    args.signal
  )
  await pruneManagedHelixdVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: result.fullVersion,
    readiness
  })
  const updated = refreshMaintainedHelixdPairing(userDataPath, environment.id, readiness)
  if (started || result.outcome !== 'already-active') {
    await followLaunchedServerPort(userDataPath, environment.id)
  }
  return {
    outcome: result.outcome === 'already-active' ? 'already-current' : 'updated',
    environment: redactRuntimeEnvironment(updated),
    activeVersion: result.fullVersion
  }
}

export function rollbackManagedHelixdEnvironment(
  userDataPath: string,
  args: LifecycleArgs
): Promise<HelixdManagedRollbackResult> {
  return withManagedHelixdLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedHelixdContext(environment, deployment, args.signal)
      const record = context.activationRecord
      const target = record.previous
      if (!target) {
        return {
          outcome: 'refused',
          code: 'helixd_rollback_no_target',
          reason: 'This server has no previous version to roll back to.'
        }
      }
      const crossing = migrationRollbackRefusal(userDataPath, environment, record.activatedAt)
      if (crossing) {
        return crossing
      }
      const slot = managedHelixdSlot(context, deployment.remotePort, args.signal)
      const targetDir = managedHelixdInstallDir(context, target)
      const targetBuildHash = await readRemoteHelixdBuildHash(slot, targetDir)
      const { countFirst, ...recount } = updateTerminalCounts((options) =>
        collectManagedTerminalCensus(userDataPath, environment, record, undefined, options)
      )
      // Recount under lock before rollback stop; this initial census closes no admission.
      const census = await countFirst()
      // Require idle because this client cannot prove the older build's daemon protocol attaches to live terminals.
      if (census.liveSessions !== 0) {
        return {
          outcome: 'refused',
          code:
            census.liveSessions === null
              ? 'helixd_rollback_census_unavailable'
              : 'helixd_rollback_terminals_running',
          reason:
            census.liveSessions === null
              ? 'The server did not answer how many terminals it runs. Retry when it answers.'
              : 'Close the terminals running on this server before rolling it back.'
        }
      }
      const result = await rollbackHelixd({
        ...slot,
        record,
        census,
        ...recount,
        targetBuildHash,
        targetDaemonProtocol: CURRENT_HELIXD_DAEMON_PROTOCOL
      })
      if (result.outcome !== 'rolled-back') {
        return result
      }
      const readiness = await probeActiveHelixdReadiness(
        { ...slot, remoteInstallDir: targetDir },
        { buildHash: targetBuildHash, fullVersion: result.target }
      )
      const updated = refreshMaintainedHelixdPairing(userDataPath, environment.id, readiness)
      await followLaunchedServerPort(userDataPath, environment.id)
      return {
        outcome: 'rolled-back',
        environment: redactRuntimeEnvironment(updated),
        activeVersion: result.target,
        discarded: result.discarded
      }
    }
  )
}

export function recoverManagedHelixdEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { acceptChangedState?: boolean }
): Promise<HelixdManagedRecoveryResult> {
  return withManagedHelixdLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedHelixdContext(environment, deployment, args.signal)
      const result = await recoverInterruptedHelixdActivation({
        ...managedHelixdSlot(context, deployment.remotePort, args.signal),
        acceptChangedState: args.acceptChangedState === true
      })
      if (result.outcome !== 'recovered') {
        return result
      }
      const updated = result.readiness
        ? refreshMaintainedHelixdPairing(userDataPath, environment.id, result.readiness)
        : environment
      if (result.activeVersion) {
        await followLaunchedServerPort(userDataPath, environment.id)
      }
      return {
        outcome: 'recovered',
        resolution: result.resolution,
        activeVersion: result.activeVersion,
        environment: redactRuntimeEnvironment(updated)
      }
    }
  )
}

/** A post-activation migration is absent from the rollback snapshot; restoring it would discard imported state. */
function migrationRollbackRefusal(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  activatedAt: string | null
): HelixdManagedRollbackResult | null {
  if (findIncompleteManagedHelixdMigration(userDataPath, environment.id)) {
    return {
      outcome: 'refused',
      code: 'helixd_rollback_migration_in_progress',
      reason: 'A migration into this server is still running. Finish it before rolling back.'
    }
  }
  const migratedAt = latestHelixdMigrationInto(userDataPath, environment)
  if (migratedAt && (activatedAt === null || Date.parse(activatedAt) < Date.parse(migratedAt))) {
    return {
      outcome: 'refused',
      code: 'helixd_rollback_crosses_migration',
      reason:
        "The previous version's state predates the projects migrated onto this server; " +
        'rolling back would lose them. Deploy forward instead.'
    }
  }
  return null
}
