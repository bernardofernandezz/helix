import type { HelixdActivationLockControl } from '../managed-server/activation/helixd-activation-lock'
import type { HelixdSnapshotVerdict } from '../managed-server/activation/helixd-activation-transaction'
import { helixdStopFreedTheHost } from '../managed-server/install/helixd-remote-process-control'
import { withoutAbortSignal } from '../managed-server/install/helixd-remote-runtime-control'
import {
  launchHelixdSlot,
  stopHelixdSlot,
  HELIXD_SLOT_STOP_WAIT_SECONDS,
  type HelixdSlotIdentity,
  type HelixdSlotOptions
} from './helixd-recovery-slot'
import { recoverHelixdIncumbent } from './helixd-incumbent-recovery'
import { errorMessage } from '../../shared/error-message'

/** Return null on proven exit; otherwise retain the fence when a delivered stop may still change the host. */
export async function stopTransactionIncumbent(
  options: HelixdSlotOptions,
  incumbent: HelixdSlotIdentity,
  lock: HelixdActivationLockControl
): Promise<{ reason: string; stopMayBeUnderway: boolean } | null> {
  const stopped = await stopHelixdSlot(options, incumbent.remoteDir, false)
  if (helixdStopFreedTheHost(stopped)) {
    return null
  }
  // Only a stop that may have been delivered can still change the host; otherwise nothing happened.
  const stopMayBeUnderway = stopped === 'still-running' || stopped === 'unconfirmed'
  if (stopMayBeUnderway) {
    lock.retain()
  }
  return {
    reason:
      `Could not verify that helixd ${incumbent.version} exited within ` +
      `${HELIXD_SLOT_STOP_WAIT_SECONDS}s (${stopped}).`,
    stopMayBeUnderway
  }
}

export async function restartAfterSnapshotFailure(
  options: HelixdSlotOptions,
  incumbent: HelixdSlotIdentity,
  lock: HelixdActivationLockControl
): Promise<string> {
  try {
    await launchHelixdSlot(withoutAbortSignal(options), incumbent)
    lock.recovered()
    return `helixd ${incumbent.version} was restarted and is serving again.`
  } catch (error) {
    lock.retain()
    return `restarting helixd ${incumbent.version} failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Restore changed state and incumbent only after both slots prove exit; refusal retains the fence. */
export async function putTransactionIncumbentBack(
  options: HelixdSlotOptions,
  lock: HelixdActivationLockControl,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: HelixdSlotIdentity | null
    restoreState: HelixdSnapshotVerdict | null
    launchedFromState?: HelixdSnapshotVerdict | null
  }
): Promise<string | null> {
  try {
    const recovery = await recoverHelixdIncumbent(withoutAbortSignal(options), {
      ...input,
      slotsProvenExited: true
    })
    if (recovery.outcome === 'refused') {
      lock.retain()
      return recovery.reason
    }
    lock.recovered()
    return null
  } catch (error) {
    lock.retain()
    return `Restoring the previous version failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Stop the rejected candidate before safely restoring incumbent state. */
export async function restoreAfterRejectedCandidate(
  options: HelixdSlotOptions,
  lock: HelixdActivationLockControl,
  input: {
    launchedDir: string
    launchedVersion: string
    transactionStartedAt: string
    incumbent: HelixdSlotIdentity | null
    restoreState: HelixdSnapshotVerdict | null
    launchedFromState?: HelixdSnapshotVerdict | null
  }
): Promise<string> {
  const { launchedDir, ...restore } = input
  const stopped = await stopHelixdSlot(withoutAbortSignal(options), launchedDir, true).catch(
    (error: unknown) => `unverifiable: ${errorMessage(error)}`
  )
  if (stopped !== 'stopped' && stopped !== 'already-exited') {
    lock.retain()
    return (
      `helixd ${input.launchedVersion} could not be confirmed stopped (${stopped}), so nothing ` +
      'was restored over state it may still own. This host requires recovery.'
    )
  }
  const failure = await putTransactionIncumbentBack(options, lock, restore)
  return (
    failure ??
    (input.incumbent
      ? `helixd ${input.incumbent.version} was restarted and is serving again.`
      : 'No previous version was active, so this host is now serving nothing.')
  )
}
