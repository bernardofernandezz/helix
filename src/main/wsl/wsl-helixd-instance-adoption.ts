/** Adopt serving unrecorded helixd under the activation fence only when lock, readiness and installed build identify the same process. Never kill it without census; launching another loses the instance lock. Normal update admission handles version changes. */
import {
  HELIXD_LOCK_FILE_NAME,
  parseHelixdInstanceLockRecord,
  type HelixdLockRecord
} from '../helixd/helixd-instance-lock'
import { compareHelixdProcessIdentity } from '../helixd/helixd-process-start-time'
import type { HelixdActivationRecord } from '../managed-server/activation/helixd-activation-record'
import {
  readHelixdActivationRecord,
  writeHelixdActivationRecord
} from '../managed-server/activation/helixd-activation-record-store'
import { evaluateHelixdActivation } from '../managed-server/activation/helixd-activation-gate'
import { withHelixdActivationLock } from '../managed-server/activation/helixd-activation-lock'
import { sameHelixdActivationRecord } from '../managed-server/activation/helixd-activation-transaction'
import { readHelixdActivationTransaction } from '../managed-server/activation/helixd-activation-transaction-store'
import { readRemoteHelixdManagedStopTarget } from '../managed-server/lifecycle/helixd-managed-remote-stop'
import {
  helixdSlotDir,
  resolveHelixdSlotIdentity,
  type HelixdSlotOptions
} from '../ssh/helixd-recovery-slot'
import { HELIXD_PID_FILENAME } from '../managed-server/install/helixd-remote-host-support'
import {
  parseHelixdReadinessWaitOutput,
  readHelixdReadinessNowCommand
} from '../managed-server/install/helixd-remote-readiness-wait'
import { readBoundedHelixdRemoteRecord } from '../managed-server/install/helixd-remote-record-file'
import { execHelixdRemote } from '../managed-server/install/helixd-remote-runtime-control'
import {
  HELIXD_INSTALL_MODEL,
  remoteInstallDirName,
  remoteInstallVersionDirRegex
} from '../managed-server/install/remote-install-model'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import { readWslGuestIdentity, wslGuestHelixdIncarnation } from './wsl-guest-process-identity'

const LOCK_RECORD_MAX_BYTES = 64 * 1024
const UNRECORDED_HELIXD_CODE = 'wsl_helixd_unrecorded_instance_unverifiable'

export type WslHelixdAdoption =
  | { outcome: 'none' }
  | { outcome: 'adopted'; version: string; pid: number; record: HelixdActivationRecord }

export class WslHelixdUnrecordedInstanceError extends Error {
  readonly code = UNRECORDED_HELIXD_CODE
  constructor(message: string) {
    super(message)
    this.name = 'WslHelixdUnrecordedInstanceError'
  }
}

type LockHolder = { pid: number; version: string }

async function readLiveLockHolder(slot: HelixdSlotOptions): Promise<LockHolder | null> {
  const lockPath = joinRemotePath(slot.host, slot.userDataDir, HELIXD_LOCK_FILE_NAME)
  const read = await readBoundedHelixdRemoteRecord(slot, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = read.state === 'present' ? parseHelixdInstanceLockRecord(read.raw) : null
  // Desktop-role or malformed locks identify no helixd to adopt.
  if (!lock || lock.role === 'desktop') {
    return null
  }
  // Adopt only proven-live holders; otherwise let the host's instance lock arbitrate launch.
  return (await lockHolderLiveness(slot, lock)) === 'live'
    ? { pid: lock.pid, version: lock.version }
    : null
}

type LockHolderLiveness = 'live' | 'unverifiable' | 'exited'

/** A PID is no identity after a distro restart reuses it: the lock's boot id and start ticks are. */
async function lockHolderLiveness(
  slot: HelixdSlotOptions,
  lock: HelixdLockRecord
): Promise<LockHolderLiveness> {
  const guest = await readWslGuestIdentity(slot.conn, lock.pid)
  if (!guest) {
    return 'unverifiable'
  }
  const incarnation = wslGuestHelixdIncarnation(guest)
  // The guest answered, and no process has that PID.
  if (!incarnation) {
    return 'exited'
  }
  // Compare boot IDs case-insensitively because readers normalize them.
  const recorded = lock.bootId ? { ...lock, bootId: lock.bootId.toLowerCase() } : lock
  const verdict = compareHelixdProcessIdentity(lock.pid, recorded, {
    incarnation: () => incarnation,
    // Ignore wall-clock starts: guest clocks jump after host sleep.
    startedAtMs: () => null,
    platform: 'linux'
  })
  return verdict === 'matches' ? 'live' : verdict === 'differs' ? 'exited' : 'unverifiable'
}

async function readSlotPid(slot: HelixdSlotOptions, version: string): Promise<number | null> {
  const pidFile = joinRemotePath(slot.host, helixdSlotDir(slot, version), HELIXD_PID_FILENAME)
  const raw = await execHelixdRemote(slot, `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`)
  const pid = Number.parseInt(raw.trim(), 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

/** The holder's slot must publish readiness for this pid, from the build installed there. */
async function proveHolderServesItsSlot(
  slot: HelixdSlotOptions,
  holder: LockHolder
): Promise<void> {
  const label = `An helixd (pid ${holder.pid}, ${holder.version}) is running in this distro but is not the recorded one`
  const dirName = remoteInstallDirName(HELIXD_INSTALL_MODEL, holder.version)
  if (!remoteInstallVersionDirRegex(HELIXD_INSTALL_MODEL).test(dirName)) {
    throw new WslHelixdUnrecordedInstanceError(`${label}, and its version is not a slot name.`)
  }
  const target = await readRemoteHelixdManagedStopTarget(slot, holder.version)
  if (target.state !== 'ready' || target.context.instance.pid !== holder.pid) {
    throw new WslHelixdUnrecordedInstanceError(
      `${label}, and it cannot be identified: ${target.state === 'refused' ? target.reason : 'its readiness names another process.'}`
    )
  }
  const identity = await resolveHelixdSlotIdentity(slot, holder.version)
  const readiness = parseHelixdReadinessWaitOutput(
    slot.host,
    await execHelixdRemote(slot, readHelixdReadinessNowCommand(slot.host, identity.remoteDir))
  )
  const verdict = evaluateHelixdActivation(
    readiness.state === 'ready' ? readiness.readiness : null,
    {
      buildHash: identity.buildHash,
      fullVersion: identity.version
    }
  )
  if (verdict.decision === 'reject') {
    throw new WslHelixdUnrecordedInstanceError(`${label}, and ${verdict.reason}`)
  }
}

function adoptedRecord(
  record: HelixdActivationRecord,
  version: string,
  now: Date
): HelixdActivationRecord {
  if (record.active === version) {
    return record
  }
  const { activeAppVersion, previousAppVersion: _previousAppVersion, ...rest } = record
  return {
    ...rest,
    active: version,
    previous: record.active ?? record.previous,
    ...(record.active && activeAppVersion ? { previousAppVersion: activeAppVersion } : {}),
    activatedAt: now.toISOString(),
    // Prelaunch snapshot belongs to another activation; rollback must not restore it.
    snapshot: null
  }
}

/** Adopt lock owners missing from record/pid file only with proof; otherwise refuse rather than launch into an occupied instance lock. */
export async function adoptUnrecordedWslHelixd(
  slot: HelixdSlotOptions,
  record: HelixdActivationRecord,
  now: () => Date = () => new Date()
): Promise<WslHelixdAdoption> {
  const holder = await readLiveLockHolder(slot)
  if (!holder) {
    return { outcome: 'none' }
  }
  if (
    record.active === holder.version &&
    (await readSlotPid(slot, holder.version)) === holder.pid
  ) {
    return { outcome: 'none' }
  }
  await proveHolderServesItsSlot(slot, holder)
  return withHelixdActivationLock(
    slot,
    async () => {
      const current = await readHelixdActivationRecord(slot)
      if (!sameHelixdActivationRecord(current, record)) {
        throw new WslHelixdUnrecordedInstanceError(
          'The activation record changed while an unrecorded helixd was being adopted. Retry.'
        )
      }
      if (await readHelixdActivationTransaction(slot)) {
        throw new WslHelixdUnrecordedInstanceError(
          'An interrupted activation is pending, so an unrecorded helixd cannot be adopted yet.'
        )
      }
      const again = await readLiveLockHolder(slot)
      if (again?.pid !== holder.pid || again.version !== holder.version) {
        throw new WslHelixdUnrecordedInstanceError(
          'The unrecorded helixd changed while it was being adopted. Retry.'
        )
      }
      const pidFile = joinRemotePath(
        slot.host,
        helixdSlotDir(slot, holder.version),
        HELIXD_PID_FILENAME
      )
      await execHelixdRemote(
        slot,
        `(umask 077 && printf '%s\\n' ${String(holder.pid)} > ${quotePosixShell(pidFile)})`
      )
      const next = adoptedRecord(current, holder.version, now())
      if (next !== current) {
        await writeHelixdActivationRecord(slot, next)
      }
      return {
        outcome: 'adopted' as const,
        version: holder.version,
        pid: holder.pid,
        record: next
      }
    },
    () => {
      throw new WslHelixdUnrecordedInstanceError(
        'Another Helix is changing this distro’s server, so an unrecorded helixd cannot be adopted now.'
      )
    }
  )
}
