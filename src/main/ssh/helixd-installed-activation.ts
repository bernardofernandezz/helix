/** Journal durably before mutation so interrupted deploys can finish or recover. Release the fence only once the host is provably settled on one slot. */
import { helixdRemoteBaseDir } from '../managed-server/install/helixd-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { HelixdDeployOptions, HelixdDeployResult } from './helixd-remote-deploy'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import {
  withActivatedVersion,
  type HelixdActivationRecord,
  type HelixdStateSnapshot
} from '../managed-server/activation/helixd-activation-record'
import {
  readHelixdActivationRecord,
  writeHelixdActivationRecord
} from '../managed-server/activation/helixd-activation-record-store'
import { launchAndJudgeHelixdSlot } from './helixd-candidate-launch-verdict'
import { planHelixdUpdate } from './helixd-update-plan'
import {
  type HelixdTerminalCensus,
  UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
} from '../../shared/helixd-terminal-census'
import { runFencedStop } from './helixd-fenced-stop'
import { CURRENT_HELIXD_DAEMON_PROTOCOL } from './helixd-daemon-protocol-crossing'
import { HELIXD_LOG_FILENAME } from '../managed-server/install/helixd-remote-host-support'
import { helixdSnapshotFailureReason } from '../managed-server/host-state/helixd-state-snapshot-space'
import {
  HELIXD_SNAPSHOT_SPACE_INSUFFICIENT_CODE,
  helixdSnapshotRoomRefusal,
  helixdSnapshotsRoot
} from './helixd-snapshot-room'
import {
  captureHelixdStateSnapshotCommand,
  helixdSnapshotDirName,
  parseHelixdSnapshotCapture
} from '../managed-server/host-state/helixd-state-snapshot'
import { joinRemotePath } from './ssh-remote-platform'
import { computeLocalHelixdBuildHash } from './helixd-local-build-hash'
import { preflightInstalledHelixd } from '../managed-server/install/helixd-remote-preflight'
import type { HelixdActivationLockControl } from '../managed-server/activation/helixd-activation-lock'
import type { HelixdActivateTransaction } from '../managed-server/activation/helixd-activation-transaction'
import {
  createHelixdActivationTransaction,
  withHelixdActivationCandidateReady,
  withHelixdActivationIncumbentStopped,
  withHelixdActivationSnapshot
} from '../managed-server/activation/helixd-activation-transaction-transitions'
import { writeHelixdActivationTransaction } from '../managed-server/activation/helixd-activation-transaction-store'
import {
  execHelixdRemoteOr,
  withoutAbortSignal
} from '../managed-server/install/helixd-remote-runtime-control'
import { execHelixdStateMutationOr } from '../managed-server/host-state/helixd-state-mutation-exec'
import {
  initialHelixdActivationAdmissionCommand,
  parseInitialHelixdActivationAdmission
} from './helixd-initial-activation-admission'
import {
  helixdSlotDir,
  resolveHelixdSlotIdentity,
  type HelixdSlotIdentity
} from './helixd-recovery-slot'
import { helixdSnapshotPath } from './helixd-incumbent-recovery'
import {
  restartAfterSnapshotFailure,
  restoreAfterRejectedCandidate,
  stopTransactionIncumbent
} from './helixd-transaction-incumbent'
import { withHelixdLogTail } from '../managed-server/install/helixd-remote-log-tail'
import { helixdCandidateLaunchFailureCode } from '../helixd/helixd-host-unavailable'
import { errorMessage } from '../../shared/error-message'

type Outcome = Extract<HelixdDeployResult, { outcome: 'installed-not-activated' }>

export const HELIXD_ACTIVATION_POLICY_REFUSED_CODE = 'helixd_activation_policy_refused'

function countedLockedRecord(
  options: HelixdDeployOptions,
  record: HelixdActivationRecord
): boolean {
  const counted = options.censusRecord
  return (
    !counted || (counted.active === record.active && counted.activatedAt === record.activatedAt)
  )
}

/** A census of another incumbent cannot authorize stopping this one. */
function censusForLockedRecord(
  options: HelixdDeployOptions,
  record: HelixdActivationRecord
): HelixdTerminalCensus {
  return countedLockedRecord(options, record) ? options.census : UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
}

export async function activateInstalledHelixd(
  options: HelixdDeployOptions & { localHelixdDir: string },
  fullVersion: string,
  remoteDir: string,
  lock: HelixdActivationLockControl
): Promise<HelixdDeployResult> {
  const now = options.now ?? ((): Date => new Date())
  const notActivated = (code: string, reason: string): Outcome => ({
    outcome: 'installed-not-activated',
    fullVersion,
    code,
    reason
  })
  const record = await readHelixdActivationRecord(options)
  const plan = planHelixdUpdate({
    record,
    candidateVersion: fullVersion,
    census: censusForLockedRecord(options, record),
    candidateDaemonProtocol: CURRENT_HELIXD_DAEMON_PROTOCOL,
    ...(options.force !== undefined ? { force: options.force } : {})
  })
  if (plan.action === 'noop') {
    return { outcome: 'already-active', fullVersion }
  }
  const refusal = options.admitRecord?.(record, fullVersion)
  if (refusal) {
    return notActivated(HELIXD_ACTIVATION_POLICY_REFUSED_CODE, refusal)
  }
  if (plan.action === 'defer') {
    return notActivated(plan.code, plan.reason)
  }

  try {
    await preflightInstalledHelixd({
      ...options,
      remoteInstallDir: remoteDir,
      fullVersion
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    return notActivated(
      'helixd_candidate_preflight_failed',
      `Candidate profile preflight failed; the incumbent was not stopped: ${errorMessage(error)}`
    )
  }

  let incumbent: HelixdSlotIdentity | null = null
  if (record.active) {
    try {
      incumbent = await resolveHelixdSlotIdentity(options, record.active)
    } catch (error) {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
      return notActivated(
        'helixd_incumbent_identity_unverifiable',
        `The active helixd ${record.active} build identity could not be verified before ` +
          `stopping it: ${errorMessage(error)} Nothing was stopped.`
      )
    }
  } else {
    const admission = parseInitialHelixdActivationAdmission(
      await execHelixdRemoteOr(
        options,
        initialHelixdActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    if (admission.decision === 'defer') {
      return notActivated(admission.code, admission.reason)
    }
  }

  // Scan snapshot room before recount so slow scans cannot outdate stop admission.
  const roomless = await helixdSnapshotRoomRefusal(options, record, fullVersion)
  if (roomless) {
    return notActivated(HELIXD_SNAPSHOT_SPACE_INSUFFICIENT_CODE, roomless)
  }

  const startedAt = now()
  let transaction: HelixdActivateTransaction = createHelixdActivationTransaction({
    transactionId: randomUUID(),
    candidateVersion: fullVersion,
    appVersion: options.appVersion,
    recordBefore: record,
    snapshotDirName: helixdSnapshotDirName(fullVersion, startedAt.getTime()),
    now: startedAt
  })
  const beginMutating = (): void => {
    lock.retainOnError()
    // After mutation starts, cancellation would strand a stopped host; finish or roll back.
    options = withoutAbortSignal(options)
  }
  if (incumbent) {
    // Recount immediately before stop; the initial census may predate a long upload.
    const fenced = await runFencedStop({
      recountCensus: () =>
        countedLockedRecord(options, record)
          ? options.recountCensus()
          : Promise.reject(new Error('not the incumbent this update counted')),
      releaseIncumbentAdmission: options.releaseIncumbentAdmission,
      now: () => now().getTime(),
      refuse: (census) => {
        const plan = planHelixdUpdate({
          record,
          candidateVersion: fullVersion,
          census,
          candidateDaemonProtocol: CURRENT_HELIXD_DAEMON_PROTOCOL,
          ...(options.force !== undefined ? { force: options.force } : {})
        })
        return plan.action === 'defer' ? notActivated(plan.code, plan.reason) : null
      },
      prepare: () => writeHelixdActivationTransaction(options, transaction),
      stale: () =>
        notActivated(
          'helixd_update_terminal_census_unavailable',
          'The terminal count went stale before the current server could be stopped, so nothing ' +
            'was stopped. Helix will try the update again.'
        ),
      stop: () => {
        beginMutating()
        return stopTransactionIncumbent(options, incumbent, lock)
      },
      stopMayHaveBeenSent: (unstopped) => unstopped === null || unstopped.stopMayBeUnderway
    })
    if ('refused' in fenced) {
      return fenced.refused
    }
    if (fenced.stopped) {
      return notActivated(
        'helixd_outgoing_stop_incomplete',
        `${fenced.stopped.reason} No snapshot was taken and the candidate was not started. Helix ` +
          'requires matching runtime readiness before signaling an incumbent and confirmed exit ' +
          'before snapshotting.'
      )
    }
  } else {
    await writeHelixdActivationTransaction(options, transaction)
    beginMutating()
  }
  transaction = withHelixdActivationIncumbentStopped(transaction, now())
  await writeHelixdActivationTransaction(options, transaction)

  // Wait for confirmed exit before snapshotting; a live SQLite WAL is not a backup boundary.
  const snapshotDir = helixdSnapshotPath(options, transaction.snapshot.dirName)
  const captureOutput = await execHelixdStateMutationOr(
    options,
    captureHelixdStateSnapshotCommand(
      options.host,
      options.userDataDir,
      snapshotDir,
      helixdRemoteBaseDir(options.host, options.remoteHome),
      {
        snapshotsRoot: helixdSnapshotsRoot(options),
        keep: [transaction.snapshot.dirName, ...(record.snapshot ? [record.snapshot.dirName] : [])]
      }
    ),
    'FAILED'
  )
  const capture = parseHelixdSnapshotCapture(captureOutput)
  if (capture === 'failed') {
    const reason = helixdSnapshotFailureReason(captureOutput)
    const restarted = incumbent
      ? ` The incumbent was stopped before snapshotting; ${await restartAfterSnapshotFailure(options, incumbent, lock)}`
      : ''
    throw new Error(
      `Could not snapshot ${options.userDataDir} before activating ${fullVersion}` +
        `${reason ? `: ${reason}` : ''}. Helix's persisted state carries no schema version, so ` +
        'without a snapshot a rollback has no way back. Refusing to activate. Fix what stops ' +
        `the copy (often a full disk or quota on ${helixdRemoteBaseDir(options.host, options.remoteHome)}), ` +
        `then reconnect.${restarted}`
    )
  }
  const snapshot: HelixdStateSnapshot | null =
    capture === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: fullVersion,
          readableByVersion: record.active,
          takenAt: startedAt.toISOString()
        }
      : null
  transaction = withHelixdActivationSnapshot(transaction, capture, now())
  await writeHelixdActivationTransaction(options, transaction)

  const { verdict, launchError } = await launchAndJudgeHelixdSlot(options, {
    remoteInstallDir: remoteDir,
    fullVersion,
    buildHash: computeLocalHelixdBuildHash(options.localHelixdDir)
  })
  if (verdict.decision === 'reject') {
    const [code, reason] =
      launchError === undefined
        ? [verdict.code, verdict.reason]
        : [
            helixdCandidateLaunchFailureCode(launchError),
            `The candidate failed while starting: ${errorMessage(launchError)}`
          ]
    const restored = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: helixdSlotDir(options, transaction.candidateVersion),
      launchedVersion: transaction.candidateVersion,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: transaction.snapshot
    })
    const located =
      `${reason} Candidate stderr is at ` +
      `${joinRemotePath(options.host, remoteDir, HELIXD_LOG_FILENAME)}. ${restored}`
    return notActivated(code, await withHelixdLogTail(options, remoteDir, located))
  }

  const recordAfter = withActivatedVersion(record, fullVersion, snapshot, now(), options.appVersion)
  transaction = withHelixdActivationCandidateReady(transaction, recordAfter, now())
  await writeHelixdActivationTransaction(options, transaction)
  await writeHelixdActivationRecord(options, recordAfter)
  return { outcome: 'installed-and-activated', fullVersion, verdict }
}
