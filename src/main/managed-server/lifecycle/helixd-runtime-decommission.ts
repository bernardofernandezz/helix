// Keep claims, tunnels and registration until the host proves server exit.
import type {
  HelixdManagedCancelStopResult,
  HelixdManagedForgetResult,
  HelixdManagedStopResult
} from '../../../shared/helixd-managed-runtime'
import type { HelixdDaemonRetirementVerdict } from '../../../shared/helixd-stop-request'
import { removeManagedHelixdEnvironment } from '../../../shared/runtime-environment-managed-helixd-store'
import type {
  KnownRuntimeEnvironment,
  HelixdSshDeploymentLink
} from '../../../shared/runtime-environments'
import { recoverInterruptedHelixdActivation } from '../activation/helixd-activation-recovery'
import { withStaleHelixdActivationRecoveryLock } from '../activation/helixd-activation-lock'
import { readHelixdActivationTransaction } from '../activation/helixd-activation-transaction-store'
import { reconcileHelixdDecommission } from './helixd-decommission-recovery'
import { cancelRemoteHelixdManagedStop } from './helixd-managed-remote-stop'
import {
  managedHelixdSlot,
  requireManagedHelixdInfrastructure,
  resolveLinkedHelixdContext
} from './helixd-managed-runtime-context'
import { closeHelixdManagedTunnel, ensureHelixdManagedTunnel } from './helixd-managed-tunnel'
import { clearManagedHelixdUpdateDeferral } from './helixd-managed-update-deferrals'
import { removeHelixdMigrationJournalsForDestination } from '../../ssh/helixd-migration-cutover-journal'
import { decommissionRemoteHelixd } from '../install/helixd-remote-decommission'
import { withManagedHelixdLifecycle } from '../../ssh/helixd-runtime-maintenance'
import { collectManagedTerminalCensus } from '../../ssh/helixd-terminal-census-client'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'

type ManagedHelixdStopPolicy = {
  isActiveEnvironment: (environmentId: string) => boolean
  retireLocalState: (environmentId: string) => Promise<void> | void
}

type Refusal = Extract<HelixdManagedStopResult, { outcome: 'refused' }>
type Stopped = { version: string | null; retirement: HelixdDaemonRetirementVerdict | null }

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

export function stopManagedHelixdEnvironment(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal },
  policy: ManagedHelixdStopPolicy
): Promise<HelixdManagedStopResult> {
  return withManagedHelixdLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'helixd_stop_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before stopping it.'
      )
    }
    const stopped = await stopRemote(userDataPath, environment, deployment, args.signal)
    if ('outcome' in stopped) {
      return stopped
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'unlinked',
      verdict: 'exited',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId,
      stoppedVersion: stopped.version,
      retirement: stopped.retirement
    }
  })
}

/** Forget local state without assuming host exit; later connects may relink a still-running server. */
export function forgetManagedHelixdEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedHelixdStopPolicy
): Promise<HelixdManagedForgetResult> {
  return withManagedHelixdLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'helixd_forget_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before forgetting it.'
      )
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'forgotten',
      verdict: 'unverifiable',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId
    }
  })
}

async function stopRemote(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: HelixdSshDeploymentLink,
  signal?: AbortSignal,
  retried = false
): Promise<Stopped | Refusal> {
  const context = await resolveLinkedHelixdContext(environment, deployment, signal)
  const slot = managedHelixdSlot(context, deployment.remotePort, signal)
  const transaction = await readHelixdActivationTransaction(slot)
  if (transaction?.operation === 'decommission') {
    // Resume the exact interrupted stop from its journal.
    const recovered = await recoverInterruptedHelixdActivation(slot)
    if (recovered.outcome === 'recovered' && recovered.activeVersion === null) {
      return { version: transaction.activeVersion, retirement: null }
    }
    if (recovered.outcome === 'refused') {
      return refuse(recovered.verdict, recovered.code, recovered.reason)
    }
    if (recovered.outcome === 'pending') {
      return refuse('unverifiable', recovered.code, recovered.reason)
    }
    // Another run may settle recovery first; restart from its resulting record.
    if (recovered.outcome === 'none') {
      return retried
        ? refuse(
            'unverifiable',
            'helixd_stop_journal_changed',
            'Another run on this server changed its stop while this one waited. Refresh and retry.'
          )
        : stopRemote(userDataPath, environment, deployment, signal, true)
    }
    return refuse(
      'live',
      'helixd_stop_withdrawn',
      'The interrupted stop was withdrawn and the server keeps serving. Stop it again.'
    )
  }
  if (transaction) {
    return refuse(
      'unverifiable',
      'helixd_activation_recovery_required',
      'An earlier update on this server was interrupted. Recover it before stopping.'
    )
  }
  const record = context.activationRecord
  if (!record.active) {
    return { version: null, retirement: null }
  }
  const census = await collectManagedTerminalCensus(userDataPath, environment, record)
  const result = await decommissionRemoteHelixd({ ...slot, record, census })
  if (result.outcome === 'refused') {
    return refuse(result.verdict, result.code, result.reason)
  }
  return { version: result.version, retirement: result.retirement }
}

async function unlinkEnvironmentLocally(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: HelixdSshDeploymentLink,
  policy: ManagedHelixdStopPolicy
): Promise<void> {
  // Remove registration before releasing claims so crashes leave a resumable hidden target.
  removeManagedHelixdEnvironment(userDataPath, environment.id)
  await policy.retireLocalState(environment.id)
  await closeHelixdManagedTunnel(environment.id)
  const { claims } = requireManagedHelixdInfrastructure()
  claims.release(deployment.sshTargetId, environment.id)
  clearManagedHelixdUpdateDeferral(environment.id)
  await claims.flush()
  // Clear journals after the fence; stale leftovers are recoverable on later conversion.
  removeHelixdMigrationJournalsForDestination(userDataPath, deployment.sshTargetId, environment.id)
}

export function cancelManagedHelixdStop(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal }
): Promise<HelixdManagedCancelStopResult> {
  return withManagedHelixdLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    const context = await resolveLinkedHelixdContext(environment, deployment, args.signal)
    const slot = managedHelixdSlot(context, deployment.remotePort, args.signal)
    let result: HelixdManagedCancelStopResult
    try {
      result = await withStaleHelixdActivationRecoveryLock(slot, async (lock) => {
        const transaction = await readHelixdActivationTransaction(slot)
        if (transaction?.operation !== 'decommission') {
          if (transaction) {
            lock.retain()
          }
          return { outcome: 'none' }
        }
        if (transaction.phase === 'process-exited') {
          lock.retain()
          return { outcome: 'already-stopped' }
        }
        if (transaction.request) {
          const cancellation = await cancelRemoteHelixdManagedStop(slot, transaction.request)
          if (cancellation.outcome !== 'canceled') {
            lock.retain()
            return {
              outcome: 'refused',
              verdict: 'live',
              code: 'helixd_stop_already_dispatched',
              reason:
                'helixd already acted on the stop and is shutting down; it cannot be canceled.'
            }
          }
        }
        const kept = await reconcileHelixdDecommission(slot, {
          action: 'keep-serving',
          version: transaction.activeVersion
        })
        if (kept.outcome !== 'recovered' || !kept.activeVersion) {
          lock.retain()
          return {
            outcome: 'refused',
            verdict: 'unverifiable',
            code: 'helixd_stop_cancel_unverifiable',
            reason: 'The stop was withdrawn but the server could not be shown to be serving.'
          }
        }
        return { outcome: 'canceled', activeVersion: kept.activeVersion }
      })
    } catch (error) {
      if (error instanceof RemoteInstallLockBusyError) {
        return {
          outcome: 'refused',
          verdict: 'unverifiable',
          code: 'helixd_stop_still_running',
          reason: 'A stop on this server may still be running. Retry after it settles.'
        }
      }
      throw error
    }
    if (result.outcome === 'canceled') {
      await ensureHelixdManagedTunnel(userDataPath, environment.id)
    }
    return result
  })
}
