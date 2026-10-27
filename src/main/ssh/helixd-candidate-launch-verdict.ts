import {
  evaluateHelixdActivation,
  type HelixdActivationVerdict
} from '../managed-server/activation/helixd-activation-gate'
import { helixdActivationTransactionRoot } from '../managed-server/activation/helixd-activation-transaction'
import type { HelixdReadinessParse } from '../managed-server/install/helixd-remote-launch'
import {
  launchHelixdAndAwaitReadiness,
  type HelixdRemoteExecTarget
} from '../managed-server/install/helixd-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'

type CandidateLaunchTarget = Parameters<typeof launchHelixdAndAwaitReadiness>[0] &
  HelixdRemoteExecTarget & {
    remoteHome: string
    nodePath: string
    userDataDir: string
    bindHost: string
    port: number
  }

/** Rethrow unconfirmed SSH cleanup: it provides no candidate evidence and must never mean rejection. */
export async function launchAndJudgeHelixdSlot(
  options: CandidateLaunchTarget,
  slot: { remoteInstallDir: string; fullVersion: string; buildHash: string }
): Promise<{ verdict: HelixdActivationVerdict; launchError: unknown }> {
  let parsed: HelixdReadinessParse | null = null
  let launchError: unknown
  try {
    parsed = await launchHelixdAndAwaitReadiness(options, {
      remoteInstallDir: slot.remoteInstallDir,
      nodePath: options.nodePath,
      fullVersion: slot.fullVersion,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      activationRoot: helixdActivationTransactionRoot(options.host, options.remoteHome)
    })
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    launchError = error
  }
  const verdict = evaluateHelixdActivation(parsed?.state === 'ready' ? parsed.readiness : null, {
    buildHash: slot.buildHash,
    fullVersion: slot.fullVersion
  })
  return { verdict, launchError }
}
