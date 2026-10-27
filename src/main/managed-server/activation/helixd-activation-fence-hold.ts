/** Retry live fences later, clear abandoned bare fences, and require recovery for interrupted journaled state. */
import {
  helixdActivationFenceExists,
  withStaleHelixdActivationRecoveryLock,
  type HelixdActivationLockOptions
} from './helixd-activation-lock'
import { readHelixdActivationTransaction } from './helixd-activation-transaction-store'
import { helixdActivationFenceLockDir } from './helixd-activation-transaction'
import { isRelayInstallLockStale } from '../install/remote-install-lock'
import { findExitedOwnLockToken } from '../../ssh/helixd-exited-own-lock'
import { helixdRemoteBaseDir } from '../install/helixd-remote-windows-node'

export const HELIXD_ACTIVATION_FENCE_BUSY_CODE = 'helixd_activation_fence_busy'
const HELIXD_ACTIVATION_RECOVERY_REQUIRED_CODE = 'helixd_activation_recovery_required'

type HelixdActivationFenceRefusal = {
  code: string
  reason: string
  /** Bare stale fence cleared; the caller may retry immediately. */
  cleared?: true
}

export async function helixdActivationFenceRefusal(
  options: HelixdActivationLockOptions,
  attempt: string
): Promise<HelixdActivationFenceRefusal> {
  const lockDir = helixdActivationFenceLockDir(options.host, options.remoteHome)
  const journal = (await readHelixdActivationTransaction(options).catch(() => null)) !== null
  const baseDir = helixdRemoteBaseDir(options.host, options.remoteHome)
  const stale =
    (await findExitedOwnLockToken(options, lockDir, { baseDir, guardsStateMutation: true })) !==
      null || (await isRelayInstallLockStale(options.conn, lockDir, options.host))
  if (stale && !journal && (await clearAbandonedFence(options))) {
    return {
      code: HELIXD_ACTIVATION_FENCE_BUSY_CODE,
      reason: `An abandoned fence held this host and was cleared; the ${attempt} is retried.`,
      cleared: true
    }
  }
  const stuck =
    stale || (journal && !(await helixdActivationFenceExists(options).catch(() => true)))
  return stuck
    ? {
        code: HELIXD_ACTIVATION_RECOVERY_REQUIRED_CODE,
        reason: `An interrupted update or stop holds this host, so the ${attempt} did not start. Recover it first.`
      }
    : {
        code: HELIXD_ACTIVATION_FENCE_BUSY_CODE,
        reason: `Another run is changing this host’s Helix server, so the ${attempt} did not start. It is retried on a later connect.`
      }
}

/** Drop a stale fence only after rechecking under takeover that no journal appeared. */
async function clearAbandonedFence(options: HelixdActivationLockOptions): Promise<boolean> {
  try {
    return await withStaleHelixdActivationRecoveryLock(options, async (lock) => {
      if (await readHelixdActivationTransaction(options)) {
        lock.retain()
        return false
      }
      return true
    })
  } catch {
    // Failed takeover leaves the fence intact for normal refusal classification.
    return false
  }
}
