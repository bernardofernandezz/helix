// Rollback restores a pre-activation snapshot: older builds may not understand newer state.
// Stop, rescue, restore, then launch; the rescue and fenced journal allow recovery of interrupted steps.
import { logHelixdActivationOutcome } from '../activation/helixd-activation-outcome-log'
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'
import type { HelixdActivationRecord } from '../activation/helixd-activation-record'
import type { HelixdTerminalCensus } from '../../../shared/helixd-terminal-census'
import type { HelixdActivationVerdict } from '../activation/helixd-activation-gate'
import type { HelixdDaemonProtocolFacts } from '../../ssh/helixd-daemon-protocol-crossing'
import { readHelixdActivationRecord } from '../activation/helixd-activation-record-store'
import { sameHelixdActivationRecord } from '../activation/helixd-activation-transaction'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  resolveHelixdActivationReadinessTimeout,
  withHelixdActivationLock
} from '../activation/helixd-activation-lock'
import { helixdActivationFenceRefusal } from '../activation/helixd-activation-fence-hold'
import { HELIXD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/helixd-profile-preflight'
import { rollbackHelixdLocked } from '../lifecycle/helixd-rollback-transition'

export type HelixdRollbackOptions = {
  conn: HelixdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  record: HelixdActivationRecord
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  census: HelixdTerminalCensus
  /** Close terminal admission, then recount under the host lock; any failure is unverifiable. */
  recountCensus: () => Promise<HelixdTerminalCensus>
  /** Reopen admission if rollback leaves the incumbent serving. */
  releaseIncumbentAdmission: () => Promise<void>
  /** Expected hash from the client's copy of the rollback target. */
  targetBuildHash: string
  /** Protocol facts from the same target bytes. */
  targetDaemonProtocol: HelixdDaemonProtocolFacts
  readinessTimeoutMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type HelixdRollbackResult =
  | {
      outcome: 'rolled-back'
      target: string
      discarded: string[]
      verdict: HelixdActivationVerdict
    }
  | { outcome: 'refused'; code: string; reason: string }
  | { outcome: 'failed'; code: string; reason: string }

export async function rollbackHelixd(input: HelixdRollbackOptions): Promise<HelixdRollbackResult> {
  const options = {
    ...input,
    readinessTimeoutMs: resolveHelixdActivationReadinessTimeout(
      input.readinessTimeoutMs,
      HELIXD_STARTUP_READINESS_TIMEOUT_MS
    )
  }
  return logHelixdActivationOutcome(
    `rollback to ${options.record.previous ?? 'none'}`,
    () =>
      withHelixdActivationLock(
        options,
        async (lock) => {
          if (
            !sameHelixdActivationRecord(await readHelixdActivationRecord(options), options.record)
          ) {
            return {
              outcome: 'refused',
              code: 'helixd_rollback_record_changed',
              reason:
                'The host activation record changed while this rollback was waiting. Refresh the ' +
                'host state and review the new rollback target before trying again.'
            }
          }
          return rollbackHelixdLocked(options, lock)
        },
        async () => {
          const { code, reason } = await helixdActivationFenceRefusal(options, 'rollback')
          return { outcome: 'refused', code, reason }
        }
      ),
    ['rolled-back']
  )
}
