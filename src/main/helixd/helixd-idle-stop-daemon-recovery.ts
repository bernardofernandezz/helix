// Cancelled idle stops may leave daemon admission closed. Replace only after atomic retirement
// agreement: replacement could otherwise kill the old daemon’s live sessions.
import { withTimeout } from '../../shared/promise-timeout-fallback'
import type { HelixdDaemonRetirement } from './helixd-daemon-retirement'
import { HELIXD_DAEMON_RETIREMENT_TIMEOUT_MS } from './helixd-stop-deadlines'

type RetirementOutcome = Pick<HelixdDaemonRetirement, 'retirement' | 'lateRetirement'>

type HelixdIdleStopDaemonRecoveryPorts = {
  admissionClosed: () => boolean
  /** Atomically recheck census and retirement fence in the daemon. */
  retireAgain: () => Promise<RetirementOutcome>
  replaceDaemon: () => Promise<unknown>
  timeoutMs?: number
}

export async function recoverDaemonAfterCancelledIdleStop(
  outcome: RetirementOutcome,
  ports: HelixdIdleStopDaemonRecoveryPorts
): Promise<'serving' | 'unservable'> {
  const timeoutMs = ports.timeoutMs ?? HELIXD_DAEMON_RETIREMENT_TIMEOUT_MS
  const retired = async (candidate: RetirementOutcome): Promise<boolean> =>
    candidate.retirement === 'retired' ||
    (candidate.lateRetirement !== undefined &&
      (await withTimeout(candidate.lateRetirement, timeoutMs, false)))
  if (!(await retired(outcome))) {
    if (!ports.admissionClosed()) {
      return 'serving'
    }
    // Only the daemon can resolve a lost retirement reply.
    const retry = await ports
      .retireAgain()
      .catch((): RetirementOutcome => ({ retirement: 'unverifiable' }))
    if (!(await retired(retry))) {
      if (ports.admissionClosed()) {
        console.error('[helixd] the terminal daemon may be retiring and did not settle it')
        return 'unservable'
      }
      return 'serving'
    }
  }
  try {
    await ports.replaceDaemon()
    console.error('[helixd] a client returned during idle stop; started a fresh terminal daemon')
    return 'serving'
  } catch (error) {
    console.error('[helixd] could not replace the retired terminal daemon:', error)
    return 'unservable'
  }
}
