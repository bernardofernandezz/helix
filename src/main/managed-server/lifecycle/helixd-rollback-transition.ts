import { helixdRemoteBaseDir } from '../install/helixd-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { HelixdRollbackOptions, HelixdRollbackResult } from '../install/helixd-remote-rollback'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { withRolledBackVersion } from '../activation/helixd-activation-record'
import { writeHelixdActivationRecord } from '../activation/helixd-activation-record-store'
import { launchAndJudgeHelixdSlot } from '../../ssh/helixd-candidate-launch-verdict'
import { assessHelixdRollback } from '../../ssh/helixd-update-plan'
import { HELIXD_LOG_FILENAME } from '../install/helixd-remote-host-support'
import {
  captureHelixdStateSnapshotCommand,
  helixdRollbackRescueDirName,
  parseHelixdSnapshotCapture,
  parseHelixdSnapshotPresence,
  parseHelixdSnapshotRestore,
  probeHelixdStateSnapshotCommand,
  restoreHelixdStateSnapshotCommand
} from '../host-state/helixd-state-snapshot'
import {
  newestStateMtimeCommand,
  parseNewestStateMtimeSeconds
} from '../host-state/helixd-state-newest-mtime'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'
import type { HelixdActivationLockControl } from '../activation/helixd-activation-lock'
import {
  rollbackStartingState,
  type HelixdRollbackTransaction
} from '../activation/helixd-activation-transaction'
import {
  createHelixdRollbackTransaction,
  withHelixdRollbackPhase,
  withHelixdRollbackRescue
} from '../activation/helixd-activation-transaction-transitions'
import { writeHelixdActivationTransaction } from '../activation/helixd-activation-transaction-store'
import { ROLLBACK_STALE_COUNT, rollbackRecountRefusal } from './helixd-rollback-admission'
import { runFencedStop } from '../../ssh/helixd-fenced-stop'
import { execHelixdRemoteOr, withoutAbortSignal } from '../install/helixd-remote-runtime-control'
import { execHelixdStateMutationOr } from '../host-state/helixd-state-mutation-exec'
import {
  helixdSlotDir,
  resolveHelixdSlotIdentity,
  type HelixdSlotIdentity
} from '../../ssh/helixd-recovery-slot'
import { helixdSnapshotPath } from '../../ssh/helixd-incumbent-recovery'
import {
  putTransactionIncumbentBack,
  restoreAfterRejectedCandidate
} from '../../ssh/helixd-transaction-incumbent'
import {
  readHelixdRollbackBarrierTarget,
  rollbackBarrierRefusal,
  stopIncumbentBehindTerminalBarrier
} from './helixd-rollback-terminal-barrier'
import { withHelixdLogTail } from '../install/helixd-remote-log-tail'
import { errorMessage } from '../../../shared/error-message'

async function stateWritesSinceActivation(options: HelixdRollbackOptions): Promise<boolean | null> {
  const activatedAtSeconds = Math.floor(Date.parse(options.record.activatedAt ?? '') / 1000)
  if (!Number.isFinite(activatedAtSeconds)) {
    return null
  }
  const newest = parseNewestStateMtimeSeconds(
    await execHelixdRemoteOr(
      options,
      newestStateMtimeCommand(
        options.host,
        options.userDataDir,
        helixdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  return newest === null ? null : newest >= activatedAtSeconds
}

export async function rollbackHelixdLocked(
  options: HelixdRollbackOptions,
  lock: HelixdActivationLockControl
): Promise<HelixdRollbackResult> {
  const now = options.now ?? ((): Date => new Date())
  const snapshot = options.record.snapshot
  const presence = snapshot
    ? parseHelixdSnapshotPresence(
        await execHelixdRemoteOr(
          options,
          probeHelixdStateSnapshotCommand(
            options.host,
            helixdSnapshotPath(options, snapshot.dirName),
            helixdRemoteBaseDir(options.host, options.remoteHome)
          )
        )
      )
    : 'absent'
  const safety = assessHelixdRollback({
    record: options.record,
    snapshotPresent: presence === 'unverifiable' ? null : presence === 'present',
    census: options.census,
    targetDaemonProtocol: options.targetDaemonProtocol,
    stateWritesSinceActivation: await stateWritesSinceActivation(options)
  })
  if (safety.safety === 'unsafe') {
    return { outcome: 'refused', code: safety.code, reason: safety.reason }
  }
  if (!snapshot || !options.record.active) {
    return {
      outcome: 'refused',
      code: 'helixd_rollback_no_active',
      reason: 'No helixd version is active on this host, so there is nothing to roll back from.'
    }
  }
  let incumbent: HelixdSlotIdentity
  try {
    incumbent = await resolveHelixdSlotIdentity(options, options.record.active)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return {
      outcome: 'refused',
      code: 'helixd_rollback_active_identity_unverifiable',
      reason: `The active helixd identity could not be verified: ${errorMessage(error)} Nothing was changed.`
    }
  }

  const barrierTarget = await readHelixdRollbackBarrierTarget(options, incumbent.version)
  if (barrierTarget.state === 'refused') {
    return { outcome: 'refused', code: barrierTarget.code, reason: barrierTarget.reason }
  }
  const startedAt = now()
  let transaction: HelixdRollbackTransaction = createHelixdRollbackTransaction({
    transactionId: randomUUID(),
    incumbentVersion: incumbent.version,
    targetVersion: safety.target,
    recordBefore: options.record,
    recordAfter: withRolledBackVersion(options.record, startedAt),
    rescueDirName: helixdRollbackRescueDirName(incumbent.version, startedAt.getTime()),
    now: startedAt
  })
  const fenced = await runFencedStop({
    recountCensus: options.recountCensus,
    releaseIncumbentAdmission: options.releaseIncumbentAdmission,
    now: () => now().getTime(),
    refuse: rollbackRecountRefusal,
    prepare: () => writeHelixdActivationTransaction(options, transaction),
    stale: () => ROLLBACK_STALE_COUNT,
    stop: async () => {
      lock.retainOnError()
      // Cancellation after mutation could strand a stopped host; finish or recover instead.
      options = withoutAbortSignal(options)
      // Pre-lock census can go stale; the fenced stop supplies the terminal-safety proof.
      return stopIncumbentBehindTerminalBarrier(
        options,
        transaction.transactionId,
        barrierTarget.context
      )
    },
    // Withdrawn stops leave the incumbent serving and needing admission reopened.
    stopMayHaveBeenSent: (barrier) => barrier.state !== 'withdrawn'
  })
  if ('refused' in fenced) {
    return fenced.refused
  }
  const blocked = rollbackBarrierRefusal(fenced.stopped)
  if (blocked) {
    if (blocked.retainFence) {
      lock.retain()
    }
    const recovered = blocked.restartIncumbent
      ? ` ${await putIncumbentBack(options, lock, transaction, incumbent)}`
      : ''
    return { outcome: blocked.outcome, code: blocked.code, reason: blocked.reason + recovered }
  }
  transaction = withHelixdRollbackPhase(transaction, 'incumbent-stopped', now())
  await writeHelixdActivationTransaction(options, transaction)

  const rescue = parseHelixdSnapshotCapture(
    await execHelixdStateMutationOr(
      options,
      captureHelixdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        helixdSnapshotPath(options, transaction.rescue.dirName),
        helixdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (rescue === 'failed') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'helixd_rollback_rescue_snapshot_failed',
      reason:
        'The current state could not be preserved in a rescue snapshot, so the data root was ' +
        `not replaced. ${recovered}`
    }
  }
  transaction = withHelixdRollbackRescue(transaction, rescue, now())
  await writeHelixdActivationTransaction(options, transaction)

  // Restore before launching: older builds must never load newer state.
  const restored = parseHelixdSnapshotRestore(
    await execHelixdStateMutationOr(
      options,
      restoreHelixdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        helixdSnapshotPath(options, snapshot.dirName),
        helixdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (restored !== 'restored') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'helixd_rollback_restore_failed',
      reason: `The pre-activation snapshot could not be restored (${restored}). ${recovered}`
    }
  }
  transaction = withHelixdRollbackPhase(transaction, 'rollback-state-restored', now())
  await writeHelixdActivationTransaction(options, transaction)

  const targetDir = helixdSlotDir(options, safety.target)
  const { verdict, launchError } = await launchAndJudgeHelixdSlot(options, {
    remoteInstallDir: targetDir,
    fullVersion: safety.target,
    buildHash: options.targetBuildHash
  })
  if (verdict.decision === 'reject') {
    const reason =
      launchError === undefined
        ? verdict.reason
        : `It failed while starting: ${errorMessage(launchError)}`
    const recovered = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: targetDir,
      launchedVersion: safety.target,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: rescueVerdict(transaction),
      launchedFromState: rollbackStartingState(transaction)
    })
    return {
      outcome: 'failed',
      code: launchError === undefined ? verdict.code : 'helixd_rollback_target_launch_failed',
      reason: await withHelixdLogTail(
        options,
        targetDir,
        `The rollback target ${safety.target} did not come up healthy: ${reason} ${recovered} ` +
          `Its stderr is at ${joinRemotePath(options.host, targetDir, HELIXD_LOG_FILENAME)}.`
      )
    }
  }

  // Until target readiness is proven, active must still identify the recoverable incumbent.
  transaction = withHelixdRollbackPhase(transaction, 'target-ready', now())
  await writeHelixdActivationTransaction(options, transaction)
  await writeHelixdActivationRecord(options, transaction.recordAfter)
  return {
    outcome: 'rolled-back',
    target: safety.target,
    discarded: safety.safety === 'lossy' ? safety.discards : [],
    verdict
  }
}

type RestoreState = Parameters<typeof putTransactionIncumbentBack>[2]['restoreState']

function rescueVerdict(transaction: HelixdRollbackTransaction): RestoreState {
  return transaction.rescue.state === 'pending' ? null : transaction.rescue
}

async function putIncumbentBack(
  options: HelixdRollbackOptions,
  lock: HelixdActivationLockControl,
  transaction: HelixdRollbackTransaction,
  incumbent: HelixdSlotIdentity
): Promise<string> {
  const failure = await putTransactionIncumbentBack(options, lock, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: null,
    incumbent,
    restoreState: rescueVerdict(transaction)
  })
  return failure ?? `helixd ${incumbent.version} was restored and is serving again.`
}
