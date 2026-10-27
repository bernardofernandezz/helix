/** Only positive host evidence proves slot exit. Unanswered probes stay unverifiable and never authorize starting a second slot. */
import type { ServeReadiness } from '../server/serve-readiness'
import type { HelixdActivationExpectation } from '../managed-server/activation/helixd-activation-gate'
import { HELIXD_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import { computeRemoteInstallDir } from '../managed-server/install/remote-versioned-install'
import { readRemoteHelixdBuildHash } from '../managed-server/install/helixd-remote-build-hash'
import {
  launchHelixdSlotAndAwaitReadiness,
  HelixdActiveReadinessError,
  probeActiveHelixdReadiness
} from './helixd-active-readiness'
import {
  helixdLivenessProbeCommand,
  helixdLivenessProvenExited,
  parseHelixdLiveness,
  type HelixdLiveness
} from '../managed-server/install/helixd-remote-launch'
import {
  parseHelixdStopOutcome,
  stopHelixdCommand,
  type HelixdStopOutcome
} from '../managed-server/install/helixd-remote-process-control'
import {
  execHelixdRemote,
  type HelixdRemoteExecTarget
} from '../managed-server/install/helixd-remote-runtime-control'
import { helixdActivationTransactionRoot } from '../managed-server/activation/helixd-activation-transaction'
import {
  initialHelixdActivationAdmissionCommand,
  parseInitialHelixdActivationAdmission
} from './helixd-initial-activation-admission'

export const HELIXD_SLOT_STOP_WAIT_SECONDS = 20

export type HelixdSlotOptions = HelixdRemoteExecTarget & {
  remoteHome: string
  /** Host Node for legacy slots only; a slot's own runtime marker wins. */
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  readinessTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type HelixdSlotIdentity = { version: string; remoteDir: string; buildHash: string }

function expectation(identity: HelixdSlotIdentity): HelixdActivationExpectation {
  return { buildHash: identity.buildHash, fullVersion: identity.version }
}

export function helixdSlotDir(options: HelixdSlotOptions, version: string): string {
  return computeRemoteInstallDir(HELIXD_INSTALL_MODEL, options.remoteHome, version)
}

/** Hash installed bytes so readiness must prove the same build. */
export async function resolveHelixdSlotIdentity(
  options: HelixdSlotOptions,
  version: string
): Promise<HelixdSlotIdentity> {
  const remoteDir = helixdSlotDir(options, version)
  return { version, remoteDir, buildHash: await readRemoteHelixdBuildHash(options, remoteDir) }
}

export function launchHelixdSlot(
  options: HelixdSlotOptions,
  identity: HelixdSlotIdentity
): Promise<ServeReadiness> {
  return launchHelixdSlotAndAwaitReadiness(
    options,
    {
      remoteInstallDir: identity.remoteDir,
      nodePath: options.nodePath,
      fullVersion: identity.version,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      // Every SSH launch is client-managed, so every one may idle out and be woken on connect.
      activationRoot: helixdActivationTransactionRoot(options.host, options.remoteHome)
    },
    expectation(identity)
  )
}

/** Proves the slot serves, starting it only on proven exit. */
export async function ensureHelixdSlotServing(
  options: HelixdSlotOptions,
  identity: HelixdSlotIdentity
): Promise<ServeReadiness> {
  const liveness = parseHelixdLiveness(
    await execHelixdRemote(options, helixdLivenessProbeCommand(options.host, identity.remoteDir))
  )
  if (liveness === 'LIVE') {
    return probeActiveHelixdReadiness(
      { ...options, remoteInstallDir: identity.remoteDir },
      expectation(identity)
    )
  }
  if (!helixdLivenessProvenExited(liveness)) {
    throw new HelixdActiveReadinessError(
      'unverifiable',
      `helixd ${identity.version} process state is unverifiable.`
    )
  }
  return launchHelixdSlot(options, identity)
}

/** `justLaunched` only for a slot this run started; otherwise the readiness PID must agree. */
export async function stopHelixdSlot(
  options: HelixdSlotOptions,
  remoteDir: string,
  justLaunched: boolean
): Promise<HelixdStopOutcome> {
  return parseHelixdStopOutcome(
    await execHelixdRemote(
      options,
      stopHelixdCommand(
        options.host,
        remoteDir,
        justLaunched
          ? { waitSeconds: HELIXD_SLOT_STOP_WAIT_SECONDS, justLaunched: true }
          : { waitSeconds: HELIXD_SLOT_STOP_WAIT_SECONDS, nodePath: options.nodePath }
      )
    )
  )
}

type HelixdSlotQuiescence = 'exited' | 'other-slot-serving'

/** Prove candidate exit before replacing state and rule out another running slot, unless it already serves. Missing PID files prove nothing: SSH may drop after nohup but before $! is recorded, so inspect data-root ownership. */
export async function quiesceInterruptedHelixdSlot(
  options: HelixdSlotOptions,
  /** `null` when nothing was launched, so only `otherSlot` needs ruling out. */
  version: string | null,
  otherSlot: HelixdSlotIdentity | null
): Promise<HelixdSlotQuiescence> {
  const remoteDir = version === null ? null : helixdSlotDir(options, version)
  const stopped =
    remoteDir === null ? 'already-exited' : await stopHelixdSlot(options, remoteDir, false)
  let exited = stopped === 'stopped' || stopped === 'already-exited'
  if ((stopped === 'unknown' || stopped === 'unconfirmed') && remoteDir !== null) {
    // No verified answer, e.g. the slot died before readiness; liveness decides.
    exited = helixdLivenessProvenExited(await slotLiveness(options, remoteDir))
  }
  if (otherSlot) {
    const other = await slotLiveness(options, otherSlot.remoteDir)
    if (other === 'LIVE' && (exited || stopped === 'no-pid')) {
      // The serving slot holds the instance lock, so a PID-less launch cannot own the state.
      await probeActiveHelixdReadiness(
        { ...options, remoteInstallDir: otherSlot.remoteDir },
        expectation(otherSlot)
      )
      return 'other-slot-serving'
    }
    if (!helixdLivenessProvenExited(other)) {
      throw new HelixdActiveReadinessError(
        'unverifiable',
        `helixd ${version ?? 'candidate'} (${stopped}) and ${otherSlot.version} (${other}) cannot both be ` +
          'ruled out as owners of the shared state; it was not replaced.'
      )
    }
  }
  if (!exited && stopped === 'no-pid' && remoteDir !== null) {
    const admission = parseInitialHelixdActivationAdmission(
      await execHelixdRemote(
        options,
        initialHelixdActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    exited = admission.decision === 'proceed'
  }
  if (!exited) {
    throw new HelixdActiveReadinessError(
      'unverifiable',
      `helixd ${version ?? 'candidate'} could not be confirmed stopped (${stopped}); replacing its state would be unsafe.`
    )
  }
  return 'exited'
}

export async function slotLiveness(
  options: HelixdSlotOptions,
  remoteDir: string
): Promise<HelixdLiveness> {
  return parseHelixdLiveness(
    await execHelixdRemote(options, helixdLivenessProbeCommand(options.host, remoteDir))
  )
}
