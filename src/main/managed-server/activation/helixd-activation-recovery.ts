// Reconcile interrupted transactions to the recorded slot and state; retain the fence whenever ownership remains unproven.
import type { ServeReadiness } from '../../server/serve-readiness'
import {
  planHelixdTransactionRecovery,
  type HelixdActivationTransaction
} from './helixd-activation-transaction'
import { readHelixdActivationTransaction } from './helixd-activation-transaction-store'
import {
  readHelixdActivationRecord,
  writeHelixdActivationRecord
} from './helixd-activation-record-store'
import {
  helixdActivationFenceExists,
  withStaleHelixdActivationRecoveryLock
} from './helixd-activation-lock'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'
import { ensureHelixdSlotServing, resolveHelixdSlotIdentity } from '../../ssh/helixd-recovery-slot'
import { reconcileHelixdDecommission } from '../lifecycle/helixd-decommission-recovery'
import {
  recoverHelixdIncumbent,
  type HelixdIncumbentRecoveryOptions
} from '../../ssh/helixd-incumbent-recovery'
import type { HelixdManagedRefusal } from '../../../shared/helixd-managed-runtime'
import { resumeInterruptedHelixdCandidate } from '../../ssh/helixd-interrupted-candidate-resume'
import { errorMessage } from '../../../shared/error-message'

export type HelixdActivationRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      readiness: ServeReadiness | null
    }
  | HelixdManagedRefusal

type HelixdActivationRecoveryOptions = HelixdIncumbentRecoveryOptions

export const HELIXD_RECOVERY_UNVERIFIABLE_CODE = 'helixd_recovery_unverifiable'

export async function recoverInterruptedHelixdActivation(
  options: HelixdActivationRecoveryOptions
): Promise<HelixdActivationRecoveryResult> {
  try {
    if (
      !(await readHelixdActivationTransaction(options)) &&
      !(await helixdActivationFenceExists(options))
    ) {
      return { outcome: 'none' }
    }
    return await withStaleHelixdActivationRecoveryLock(options, async (lock) => {
      const transaction = await readHelixdActivationTransaction(options)
      if (!transaction) {
        // Interrupted release can remove the journal before the fence; finishing release is enough.
        return { outcome: 'none' }
      }
      const result = await reconcileHelixdTransaction(options, transaction)
      if (result.outcome !== 'recovered') {
        lock.retain()
      }
      return result
    })
  } catch (error) {
    if (error instanceof RemoteInstallLockBusyError) {
      return {
        outcome: 'pending',
        code: 'helixd_recovery_transaction_still_fresh',
        reason:
          'The activation fence is held by a run that may still be working. Retry after the ' +
          'install lock recovery window.'
      }
    }
    return {
      outcome: 'refused',
      verdict: 'unverifiable',
      code: HELIXD_RECOVERY_UNVERIFIABLE_CODE,
      reason:
        `The interrupted activation could not be reconciled safely: ${errorMessage(error)} ` +
        'The host remains fenced.'
    }
  }
}

/** Requires a held fence; unverifiable steps throw to preserve it. */
async function reconcileHelixdTransaction(
  options: HelixdActivationRecoveryOptions,
  transaction: HelixdActivationTransaction
): Promise<HelixdActivationRecoveryResult> {
  const plan = planHelixdTransactionRecovery(transaction, await readHelixdActivationRecord(options))
  if (plan.action === 'refuse') {
    return { outcome: 'refused', verdict: 'unverifiable', code: plan.code, reason: plan.reason }
  }
  if (
    plan.action === 'confirm-decommissioned' ||
    plan.action === 'resume-stop' ||
    plan.action === 'keep-serving'
  ) {
    return reconcileHelixdDecommission(options, plan)
  }
  if (plan.action === 'finish-commit') {
    await writeHelixdActivationRecord(options, plan.record)
  }
  if (plan.action === 'stabilize-committed' || plan.action === 'finish-commit') {
    const activeVersion = plan.action === 'finish-commit' ? plan.record.active : plan.activeVersion
    if (!activeVersion) {
      throw new Error('The committed activation record has no active version.')
    }
    const identity = await resolveHelixdSlotIdentity(options, activeVersion)
    return {
      outcome: 'recovered',
      resolution: 'committed',
      activeVersion,
      readiness: await ensureHelixdSlotServing(options, identity)
    }
  }
  if (transaction.operation === 'activate' && plan.launchedVersion) {
    const readiness = await resumeInterruptedHelixdCandidate(options, transaction)
    if (readiness && 'outcome' in readiness) {
      return readiness
    }
    if (readiness) {
      return {
        outcome: 'recovered',
        resolution: 'committed',
        activeVersion: transaction.candidateVersion,
        readiness
      }
    }
  }
  const recovery = await recoverHelixdIncumbent(options, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: plan.launchedVersion,
    incumbent: plan.activeVersion
      ? await resolveHelixdSlotIdentity(options, plan.activeVersion)
      : null,
    restoreState: plan.restoreState,
    launchedFromState: plan.launchedFromState
  })
  return recovery.outcome === 'refused'
    ? recovery
    : {
        outcome: 'recovered',
        resolution: 'restored-incumbent',
        activeVersion: plan.activeVersion,
        readiness: recovery.readiness
      }
}
