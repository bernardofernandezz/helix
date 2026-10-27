// Helixd exit does not prove terminal exit: the terminal daemon can outlive the server.
import { HELIXD_FENCE_OWNER_FILENAME } from '../activation/helixd-activation-fence-scope'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readHelixdActivationRecord } from '../activation/helixd-activation-record-store'
import { randomUUID } from 'node:crypto'
import {
  helixdActivationFenceExists,
  releaseHelixdActivationFence,
  withHelixdActivationLock
} from '../activation/helixd-activation-lock'
import { helixdLivenessProvenExited } from '../install/helixd-remote-launch'
import { readBoundedHelixdRemoteRecord } from '../install/helixd-remote-record-file'
import { helixdActivationFenceLockDir } from '../activation/helixd-activation-transaction'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'

import { readHelixdActivationTransaction } from '../activation/helixd-activation-transaction-store'
import {
  HELIXD_RECOVERY_UNVERIFIABLE_CODE,
  recoverInterruptedHelixdActivation
} from '../activation/helixd-activation-recovery'
import {
  ensureHelixdSlotServing,
  helixdSlotDir,
  resolveHelixdSlotIdentity,
  slotLiveness,
  type HelixdSlotOptions
} from '../../ssh/helixd-recovery-slot'

type HelixdManagedWake =
  | { outcome: 'serving' | 'not-activated' | 'unverifiable' }
  | { outcome: 'fenced' }
  | { outcome: 'started'; readiness: ServeReadiness }
  | { outcome: 'recovery-refused'; reason: string }

/** Start only proven-stopped active slots; leave live or unverifiable processes alone. */
export function wakeStoppedManagedHelixd(
  options: HelixdSlotOptions,
  onStarting: () => void = () => {}
): Promise<HelixdManagedWake> {
  const host = wakeHostKey(options)
  // Serialize per host before remote work so reconnect cannot race an earlier wake's unexplained fence.
  const prior = runningWakes.get(host)
  const wake = (async (): Promise<HelixdManagedWake> => {
    await prior?.catch(() => {})
    return wakeAfterPrior(options, host, onStarting)
  })()
  runningWakes.set(host, wake)
  void wake
    .catch(() => {})
    .finally(() => {
      if (runningWakes.get(host) === wake) {
        runningWakes.delete(host)
      }
    })
  return wake
}

async function wakeAfterPrior(
  options: HelixdSlotOptions,
  host: string,
  onStarting: () => void
): Promise<HelixdManagedWake> {
  const before = await readHelixdActivationRecord(options)
  if (!before.active) {
    return { outcome: 'not-activated' }
  }
  const liveness = await slotLiveness(options, helixdSlotDir(options, before.active))
  if (!helixdLivenessProvenExited(liveness)) {
    return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
  }
  if (!(await helixdActivationFenceExists(options))) {
    interruptedWakes.delete(host)
  } else if (!(await releaseOwnInterruptedWakeFence(options, host))) {
    const recovered = await recoverAbandonedFence(options, onStarting)
    if (recovered) {
      return recovered
    }
  }
  // Record ownership before acquisition: dropped replies can leave fences only this token can reclaim.
  const token = randomUUID()
  interruptedWakes.set(host, token)
  const result = await withHelixdActivationLock(
    options,
    async (): Promise<HelixdManagedWake> => {
      // Other clients may change the active slot; reread under the fence.
      const active = (await readHelixdActivationRecord(options)).active
      if (!active) {
        return { outcome: 'not-activated' }
      }
      const identity = await resolveHelixdSlotIdentity(options, active)
      onStarting()
      return { outcome: 'started', readiness: await ensureHelixdSlotServing(options, identity) }
    },
    (): HelixdManagedWake => ({ outcome: 'fenced' }),
    token
  )
  if (interruptedWakes.get(host) === token) {
    interruptedWakes.delete(host)
  }
  return result
}

/** Recover abandoned journals under stale, previous-boot or proven-exited fences; busy runs retain ownership. */
async function recoverAbandonedFence(
  options: HelixdSlotOptions,
  onStarting: () => void
): Promise<HelixdManagedWake | null> {
  const recovery = await recoverInterruptedHelixdActivation(options)
  switch (recovery.outcome) {
    case 'none':
      return null
    case 'pending':
      return { outcome: 'fenced' }
    case 'refused':
      // Retry unverifiable recovery at the next fence check, as with a busy owner.
      return recovery.code === HELIXD_RECOVERY_UNVERIFIABLE_CODE
        ? { outcome: 'fenced' }
        : { outcome: 'recovery-refused', reason: recovery.reason }
    case 'recovered':
      if (!recovery.readiness) {
        return { outcome: 'not-activated' }
      }
      onStarting()
      return { outcome: 'started', readiness: recovery.readiness }
  }
}

const runningWakes = new Map<string, Promise<HelixdManagedWake>>()

const interruptedWakes = new Map<string, string>()

function wakeOwnerPath(options: HelixdSlotOptions): string {
  return joinRemotePath(
    options.host,
    helixdActivationFenceLockDir(options.host, options.remoteHome),
    HELIXD_FENCE_OWNER_FILENAME
  )
}

function wakeHostKey(options: HelixdSlotOptions): string {
  return `${options.conn.getTarget().id}\0${options.remoteHome}`
}

/** Reclaim only this client's journal-free interrupted fence after proving slot exit. */
async function releaseOwnInterruptedWakeFence(
  options: HelixdSlotOptions,
  host: string
): Promise<boolean> {
  const token = interruptedWakes.get(host)
  if (!token || (await readHelixdActivationTransaction(options))) {
    return false
  }
  // A new owner may not have written its token yet; absence cannot prove this fence ours.
  const owner = await readBoundedHelixdRemoteRecord(options, wakeOwnerPath(options), 64)
  if (owner.state !== 'present' || owner.raw.trim() !== token) {
    interruptedWakes.delete(host)
    return false
  }
  await releaseHelixdActivationFence(options, token)
  interruptedWakes.delete(host)
  return true
}
