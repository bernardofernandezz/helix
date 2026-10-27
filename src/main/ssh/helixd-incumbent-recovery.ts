/** Restore changed state only after proven slot exit and operator consent: a launched RPC server may have created terminals the stopped host cannot census, making the snapshot stale. Use the same rule for failure and crash recovery. */
import { execHelixdStateMutation } from '../managed-server/host-state/helixd-state-mutation-exec'
import { helixdRemoteBaseDir } from '../managed-server/install/helixd-remote-windows-node'
import type { ServeReadiness } from '../server/serve-readiness'
import { RELAY_REMOTE_DIR } from './remote-exec/remote-frame-protocol'
import { HELIXD_STATE_SNAPSHOT_DIR } from '../managed-server/activation/helixd-activation-record'
import type { HelixdSnapshotVerdict } from '../managed-server/activation/helixd-activation-transaction'
import {
  clearHelixdStateSnapshotMembersCommand,
  compareHelixdStateSnapshotCommand,
  helixdSnapshotIsUnchanged,
  parseHelixdSnapshotRestore,
  restoreHelixdStateSnapshotCommand
} from '../managed-server/host-state/helixd-state-snapshot'
import { execHelixdRemote } from '../managed-server/install/helixd-remote-runtime-control'
import {
  ensureHelixdSlotServing,
  launchHelixdSlot,
  quiesceInterruptedHelixdSlot,
  type HelixdSlotIdentity,
  type HelixdSlotOptions
} from './helixd-recovery-slot'
import { joinRemotePath } from './ssh-remote-platform'
import { HELIXD_RECOVERY_CHANGED_STATE_CODE } from '../../shared/helixd-managed-runtime'

export type HelixdIncumbentRecoveryOptions = HelixdSlotOptions & {
  /** The operator accepted restoring the snapshot over state a launched build changed. */
  acceptChangedState?: boolean
}

type HelixdIncumbentRecovery =
  | { outcome: 'restored'; readiness: ServeReadiness | null }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

export function helixdSnapshotPath(options: HelixdSlotOptions, dirName: string): string {
  return joinRemotePath(
    options.host,
    options.remoteHome,
    RELAY_REMOTE_DIR,
    HELIXD_STATE_SNAPSHOT_DIR,
    dirName
  )
}

/** Unverifiable steps throw so the caller retains the fence. */
export async function recoverHelixdIncumbent(
  options: HelixdIncumbentRecoveryOptions,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: HelixdSlotIdentity | null
    restoreState: HelixdSnapshotVerdict | null
    /** Rollback may restore a different snapshot from the launched slot's starting state. */
    launchedFromState?: HelixdSnapshotVerdict | null
    /** This run itself proved both slots exited, so no fresh liveness probe is needed. */
    slotsProvenExited?: boolean
  }
): Promise<HelixdIncumbentRecovery> {
  const quiescence =
    input.slotsProvenExited || !input.restoreState
      ? 'exited'
      : await quiesceInterruptedHelixdSlot(options, input.launchedVersion, input.incumbent)
  // With no incumbent there is no older reader to protect; the record names nothing to serve.
  if (quiescence === 'exited' && input.restoreState && input.incumbent) {
    const decision = input.launchedVersion
      ? await decideChangedStateRestore(options, input.launchedFromState ?? input.restoreState)
      : 'restore'
    if (decision !== 'restore' && decision !== 'unchanged') {
      return decision
    }
    // A launched slot that left its starting state untouched still sits on a root to replace.
    if (decision === 'restore' || input.launchedFromState) {
      await restoreState(options, input.restoreState)
    }
  }
  if (!input.incumbent) {
    return { outcome: 'restored', readiness: null }
  }
  return {
    outcome: 'restored',
    readiness: input.slotsProvenExited
      ? await launchHelixdSlot(options, input.incumbent)
      : await ensureHelixdSlotServing(options, input.incumbent)
  }
}

async function decideChangedStateRestore(
  options: HelixdIncumbentRecoveryOptions,
  state: HelixdSnapshotVerdict
): Promise<'unchanged' | 'restore' | Extract<HelixdIncumbentRecovery, { outcome: 'refused' }>> {
  if (state.state === 'captured') {
    const snapshotDir = helixdSnapshotPath(options, state.dirName)
    // A lost read-only comparison can conservatively mean changed.
    const comparison = await execHelixdRemote(
      options,
      compareHelixdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        snapshotDir,
        helixdRemoteBaseDir(options.host, options.remoteHome)
      )
    ).catch(() => '')
    if (helixdSnapshotIsUnchanged(comparison)) {
      return 'unchanged'
    }
  }
  if (options.acceptChangedState) {
    return 'restore'
  }
  const retained =
    state.state === 'captured' ? ` at ${helixdSnapshotPath(options, state.dirName)}` : ''
  return {
    outcome: 'refused',
    verdict: 'unverifiable',
    code: HELIXD_RECOVERY_CHANGED_STATE_CODE,
    reason:
      'The launched build is stopped, but it changed profile state (or the change could not be ' +
      'checked), so the previous build was not restarted against it and this host serves ' +
      'nothing. Recover to restore the prelaunch snapshot' +
      `${retained} and restart the previous build; terminals the launched build started keep ` +
      'running but drop out of the restored state.'
  }
}

async function restoreState(
  options: HelixdSlotOptions,
  state: HelixdSnapshotVerdict
): Promise<void> {
  if (state.state === 'pending') {
    throw new Error('The interrupted transaction has no durable snapshot verdict.')
  }
  const command =
    state.state === 'captured'
      ? restoreHelixdStateSnapshotCommand(
          options.host,
          options.userDataDir,
          helixdSnapshotPath(options, state.dirName),
          helixdRemoteBaseDir(options.host, options.remoteHome)
        )
      : clearHelixdStateSnapshotMembersCommand(
          options.host,
          options.userDataDir,
          helixdRemoteBaseDir(options.host, options.remoteHome)
        )
  const restored = parseHelixdSnapshotRestore(await execHelixdStateMutation(options, command))
  if (restored !== 'restored') {
    throw new Error(`The prelaunch state could not be restored (${restored}).`)
  }
}
