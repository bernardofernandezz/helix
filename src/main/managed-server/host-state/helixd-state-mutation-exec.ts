// SSH channel closure does not prove host mutation exit; only command output or exit may release the activation fence.
import { HELIXD_STATE_MUTATION_DEADLINE_SECONDS } from './helixd-state-snapshot'
import {
  HELIXD_STATE_MUTATION_BUSY,
  HELIXD_STATE_MUTATION_DEADLINE
} from './helixd-state-snapshot-members'
import type { HelixdRemoteExecTarget } from '../install/helixd-remote-runtime-control'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import {
  isHelixdFenceLost,
  HelixdFenceLostError
} from '../activation/helixd-activation-fence-scope'

// Let the host deadline kill workload before client observation times out.
export const HELIXD_STATE_MUTATION_CLIENT_TIMEOUT_MS =
  (HELIXD_STATE_MUTATION_DEADLINE_SECONDS + 60) * 1000

function unconfirmed(error: Error): Error & { sshChannelCloseConfirmed: false } {
  return Object.assign(error, { sshChannelCloseConfirmed: false as const })
}

/** Do not abort observation: caller cancellation cannot stop host-side mutation. */
export async function execHelixdStateMutation(
  target: HelixdRemoteExecTarget,
  command: string
): Promise<string> {
  let output: string
  try {
    output = await execCommand(target.conn, command, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: HELIXD_STATE_MUTATION_CLIENT_TIMEOUT_MS
    })
  } catch (error) {
    // Channel termination flags uncertainty; exit-status errors prove completion.
    if (error instanceof Error && 'sshChannelCloseConfirmed' in error) {
      throw unconfirmed(error)
    }
    throw isHelixdFenceLost(error) ? new HelixdFenceLostError() : error
  }
  const verdict = output.trim().split('\n').pop()?.trim()
  if (verdict === HELIXD_STATE_MUTATION_BUSY) {
    throw unconfirmed(
      new Error('Another snapshot capture or restore is still running on the host.')
    )
  }
  if (verdict === HELIXD_STATE_MUTATION_DEADLINE) {
    throw unconfirmed(
      new Error(
        `A snapshot capture or restore ran past ${HELIXD_STATE_MUTATION_DEADLINE_SECONDS}s and ` +
          'the host stopped it part way through.'
      )
    )
  }
  return output
}

/** Fall back only for finished failures; unconfirmed mutation remains fenced. */
export function execHelixdStateMutationOr(
  target: HelixdRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execHelixdStateMutation(target, command).catch((error: unknown) => {
    // Lost ownership is a refusal, never a capture failure eligible for fallback.
    if (isUnconfirmedSshCommandTermination(error) || error instanceof HelixdFenceLostError) {
      throw error
    }
    return fallback
  })
}
