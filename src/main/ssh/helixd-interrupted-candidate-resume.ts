/** Resume through the original readiness gate before undoing: the candidate may already serve changed state, and stopping it could require operator consent before anything can serve again. */
import type { ServeReadiness } from '../server/serve-readiness'
import { withActivatedVersion } from '../managed-server/activation/helixd-activation-record'
import { writeHelixdActivationRecord } from '../managed-server/activation/helixd-activation-record-store'
import type { HelixdActivateTransaction } from '../managed-server/activation/helixd-activation-transaction'
import { writeHelixdActivationTransaction } from '../managed-server/activation/helixd-activation-transaction-store'
import { withHelixdActivationCandidateReady } from '../managed-server/activation/helixd-activation-transaction-transitions'
import { HelixdActiveReadinessError } from './helixd-active-readiness'
import { helixdLivenessProvenExited } from '../managed-server/install/helixd-remote-launch'
import {
  HELIXD_RECOVERY_CHANGED_STATE_CODE,
  type HelixdManagedRefusal
} from '../../shared/helixd-managed-runtime'
import {
  ensureHelixdSlotServing,
  helixdSlotDir,
  resolveHelixdSlotIdentity,
  slotLiveness
} from './helixd-recovery-slot'
import type { HelixdIncumbentRecoveryOptions } from './helixd-incumbent-recovery'

/** Under the held fence, return null for undo; a refusal leaves the host untouched for an operator. */
export async function resumeInterruptedHelixdCandidate(
  options: HelixdIncumbentRecoveryOptions,
  transaction: HelixdActivateTransaction
): Promise<ServeReadiness | HelixdManagedRefusal | null> {
  const snapshotState = transaction.snapshot.state
  const incumbent = transaction.recordBefore.active
  if (
    transaction.phase !== 'snapshot-captured' ||
    snapshotState === 'pending' ||
    // A serving incumbent holds the port and instance lock; undo keeps it.
    (incumbent !== null &&
      !helixdLivenessProvenExited(await slotLiveness(options, helixdSlotDir(options, incumbent))))
  ) {
    return null
  }
  const candidate = await resolveHelixdSlotIdentity(options, transaction.candidateVersion)
  const candidateLiveness = await slotLiveness(options, candidate.remoteDir)
  // Old journals lack candidate app version, so commit would drop downgrade protection; undo a possibly serving candidate only with consent.
  if (transaction.candidateAppVersion === undefined) {
    if (helixdLivenessProvenExited(candidateLiveness) || options.acceptChangedState) {
      return null
    }
    if (candidateLiveness === 'UNKNOWN') {
      throw new Error(`Could not tell whether helixd ${transaction.candidateVersion} is running.`)
    }
    return {
      outcome: 'refused',
      verdict: 'live',
      code: HELIXD_RECOVERY_CHANGED_STATE_CODE,
      reason:
        `An older Helix left version ${transaction.candidateVersion} running without finishing ` +
        'its update, and did not record which app started it, so it was neither committed nor ' +
        'stopped. Recover to stop it, restore the prelaunch snapshot and restart the previous ' +
        'build; what it changed is discarded.'
    }
  }
  // Undo must rule out an unprovable candidate before starting another slot.
  if (candidateLiveness === 'UNKNOWN') {
    return null
  }
  let readiness: ServeReadiness
  try {
    readiness = await ensureHelixdSlotServing(options, candidate)
  } catch (error) {
    // Only candidate evidence permits undo; unanswered hosts retain the fence.
    if (error instanceof HelixdActiveReadinessError && error.verdict !== 'unverifiable') {
      return null
    }
    throw error
  }
  const now = new Date()
  const recordAfter = withActivatedVersion(
    transaction.recordBefore,
    transaction.candidateVersion,
    snapshotState === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: transaction.candidateVersion,
          readableByVersion: incumbent,
          takenAt: transaction.startedAt
        }
      : null,
    now,
    transaction.candidateAppVersion ?? undefined
  )
  await writeHelixdActivationTransaction(
    options,
    withHelixdActivationCandidateReady(transaction, recordAfter, now)
  )
  await writeHelixdActivationRecord(options, recordAfter)
  return readiness
}
