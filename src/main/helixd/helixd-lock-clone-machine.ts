// Images cloned with one /etc/machine-id look like one machine to every PID check.
import { statSync, utimesSync } from 'node:fs'
import process from 'node:process'
import { HELIX_MACHINE_NAME_ENV } from '../../shared/helixd-managed-launch-env'
import type { HelixdPeerMachine } from './helixd-lock-holder-locality'
import { currentLinuxBootStartedAtMs } from '../persistence/profile-state/profile-state-access-identity'

const CLONE_MACHINE_ID_HINT =
  'Machines cloned from one image share /etc/machine-id, so Helix cannot tell them apart. If the Helix ' +
  'on the clone crashed, a normal start takes over once its lock goes 5 minutes without a heartbeat. ' +
  'On the clone, run `sudo rm /etc/machine-id && sudo systemd-machine-id-setup` and reboot it.'
const CLONE_OWN_DATA_HINT =
  'Or, on that machine only, give Helix its own data: for Helix-managed SSH servers set ' +
  `${HELIX_MACHINE_NAME_ENV} where its non-interactive SSH logins read it (~/.zshenv, or above the ` +
  'interactive check in ~/.bashrc), guarded by a test that matches only that machine, since a ' +
  'shared home applies it everywhere; for `helix serve` set HELIX_USER_DATA.'

/** Lock heartbeats refresh the record's mtime well inside this window. */
export const HELIXD_LOCK_HEARTBEAT_MS = 60_000
export const HELIXD_LOCK_FRESH_MS = 5 * HELIXD_LOCK_HEARTBEAT_MS

/**
 * Images cloned with one /etc/machine-id (and often one hostname) differ only by boot. A record from
 * another boot is this machine's own unless it was written after this boot began; staleness lets a
 * crashed clone's record go. Hostnames are ignored: renames change them and clones repeat them.
 */
export function helixdPeerIsLiveCloneMachine(
  peer: HelixdPeerMachine,
  self: HelixdPeerMachine,
  dataRootIsOnLocalDisk: () => boolean,
  platform: NodeJS.Platform = process.platform
): boolean {
  const { writtenAtMs } = peer
  const { bootStartedAtMs, nowMs } = self
  return (
    platform === 'linux' &&
    !!peer.machineIdentity &&
    peer.machineIdentity === self.machineIdentity &&
    !!peer.bootId &&
    !!self.bootId &&
    peer.bootId !== self.bootId &&
    writtenAtMs !== undefined &&
    bootStartedAtMs !== undefined &&
    nowMs !== undefined &&
    writtenAtMs > bootStartedAtMs &&
    nowMs - writtenAtMs < HELIXD_LOCK_FRESH_MS &&
    !dataRootIsOnLocalDisk()
  )
}

/** A heartbeat refreshes the lock file's mtime; the record's own time covers older versions. */
export function helixdLockPeer(
  record: HelixdPeerMachine & { acquiredAt: string },
  lockPath: string | null
): HelixdPeerMachine {
  let mtimeMs = 0
  try {
    mtimeMs = lockPath === null ? 0 : statSync(lockPath).mtimeMs
  } catch {
    // A vanished lock leaves the record's own time.
  }
  const acquiredAtMs = Date.parse(record.acquiredAt)
  const writtenAtMs = Math.max(Number.isFinite(acquiredAtMs) ? acquiredAtMs : 0, mtimeMs)
  return { ...record, ...(writtenAtMs > 0 ? { writtenAtMs } : {}) }
}

/** This machine as judged against peers: its boot start dates records from earlier boots. */
export function helixdLockSelf(
  self: HelixdPeerMachine,
  nowMs: number,
  bootStartedAtMs: number | null = currentLinuxBootStartedAtMs()
): HelixdPeerMachine {
  return { ...self, nowMs, ...(bootStartedAtMs === null ? {} : { bootStartedAtMs }) }
}

/** Keep the lock's mtime fresh so a machine sharing this machine-id can see the holder lives. */
export function startHelixdLockHeartbeat(lockPath: string): () => void {
  const heartbeat = setInterval(() => {
    try {
      const now = new Date()
      utimesSync(lockPath, now, now)
    } catch (error) {
      // A stalled heartbeat lets a machine sharing this machine-id take the lock.
      console.warn('[helixd] could not refresh the instance lock heartbeat:', error)
    }
  }, HELIXD_LOCK_HEARTBEAT_MS)
  heartbeat.unref()
  return () => clearInterval(heartbeat)
}

export function helixdCloneMachineHint(role: 'helixd' | 'desktop'): string {
  const ownData = role === 'desktop' ? '' : ` ${CLONE_OWN_DATA_HINT}`
  return `${CLONE_MACHINE_ID_HINT}${ownData}`
}
