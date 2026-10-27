import {
  evaluateHelixdActivation,
  type HelixdActivationExpectation
} from '../managed-server/activation/helixd-activation-gate'
import {
  helixdLivenessProbeCommand,
  parseHelixdLiveness,
  type HelixdLaunchSpec,
  type HelixdReadinessParse
} from '../managed-server/install/helixd-remote-launch'
import {
  execHelixdRemote,
  launchHelixdAndAwaitReadiness,
  type HelixdRemoteExecTarget
} from '../managed-server/install/helixd-remote-runtime-control'
import {
  parseHelixdReadinessWaitOutput,
  readHelixdReadinessNowCommand
} from '../managed-server/install/helixd-remote-readiness-wait'
import type { ServeReadiness } from '../server/serve-readiness'
import { withHelixdLogTail } from '../managed-server/install/helixd-remote-log-tail'

type HelixdReadinessFailureVerdict = 'exited' | 'unverifiable' | 'rejected'

export class HelixdActiveReadinessError extends Error {
  constructor(
    readonly verdict: HelixdReadinessFailureVerdict,
    message: string
  ) {
    super(message)
    this.name = 'HelixdActiveReadinessError'
  }
}

function gatedReadiness(
  parsed: HelixdReadinessParse,
  expectation: HelixdActivationExpectation,
  label: string
): ServeReadiness {
  const readiness = parsed.state === 'ready' ? parsed.readiness : null
  const verdict = evaluateHelixdActivation(readiness, expectation)
  if (verdict.decision === 'reject') {
    throw new HelixdActiveReadinessError(
      'rejected',
      `${label} failed its readiness check: ${verdict.reason}`
    )
  }
  if (!readiness) {
    throw new HelixdActiveReadinessError(
      'rejected',
      `${label} passed activation without a readiness payload.`
    )
  }
  const coverage = helixdDaemonCoverageRefusal(readiness)
  if (coverage) {
    throw new HelixdActiveReadinessError('rejected', `${label} ${coverage}`)
  }
  return readiness
}

/** Require PTY self-test coverage, or handshake on platforms that cannot spawn-probe. Older slots without coverage metadata retain the identity-only gate. */
function helixdDaemonCoverageRefusal(readiness: ServeReadiness): string | null {
  const health = readiness.health
  const coverage = health?.terminalDaemon?.selfTest?.coverage
  if (!health || coverage === undefined || coverage === 'pty-spawn') {
    return null
  }
  if (coverage === 'handshake' && health.platform === 'win32') {
    return null
  }
  return (
    `reported terminal-daemon coverage '${String(coverage)}', which does not prove a PTY can ` +
    `be created on ${health.platform}.`
  )
}

export async function probeActiveHelixdReadiness(
  target: HelixdRemoteExecTarget & { remoteInstallDir: string },
  expectation: HelixdActivationExpectation
): Promise<ServeReadiness> {
  const liveness = parseHelixdLiveness(
    await execHelixdRemote(target, helixdLivenessProbeCommand(target.host, target.remoteInstallDir))
  )
  if (liveness === 'DEAD') {
    throw new HelixdActiveReadinessError(
      'exited',
      `helixd ${expectation.fullVersion} is recorded active but its process has exited.`
    )
  }
  if (liveness === 'NEVER_LAUNCHED') {
    throw new HelixdActiveReadinessError(
      'exited',
      `helixd ${expectation.fullVersion} is recorded active but was never started from its install directory.`
    )
  }
  if (liveness !== 'LIVE') {
    throw new HelixdActiveReadinessError(
      'unverifiable',
      `helixd ${expectation.fullVersion} process state is unverifiable.`
    )
  }
  const parsed = parseHelixdReadinessWaitOutput(
    target.host,
    await execHelixdRemote(
      target,
      readHelixdReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return gatedReadiness(parsed, expectation, 'The active helixd')
}

/** Accept recovery/rollback launches only when they prove the expected build. */
export async function launchHelixdSlotAndAwaitReadiness(
  target: HelixdRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: HelixdLaunchSpec,
  expectation: HelixdActivationExpectation
): Promise<ServeReadiness> {
  const parsed = await launchHelixdAndAwaitReadiness(target, spec)
  try {
    return gatedReadiness(parsed, expectation, `helixd ${spec.fullVersion}`)
  } catch (error) {
    if (!(error instanceof HelixdActiveReadinessError)) {
      throw error
    }
    const message = await withHelixdLogTail(target, spec.remoteInstallDir, error.message)
    throw new HelixdActiveReadinessError(error.verdict, message)
  }
}
