// Linux ticks/boot ID avoid drifting wall time; Windows uses kernel creation time. Unknown never proves exit.
import { readFileSync, statSync } from 'node:fs'
import { parseLinuxStartTicks } from '../agent-hooks/managed-hook-owner-identity'
import {
  getProcessStartedAtMs,
  START_TIME_TOLERANCE_MS,
  startTimesWithinTolerance
} from '../daemon/daemon-process-start-time'
import { readWindowsProcessCreationTime } from '../windows/windows-process-table'

export type HelixdProcessIncarnation = { linuxStartTicks: string; bootId: string }

/** Older writers omit incarnation fields. */
export type HelixdRecordedIdentity = {
  startedAtMs: number | null
  linuxStartTicks?: string
  bootId?: string
  /** Holder POSIX uid (decimal) or Windows username. */
  identity?: string
}

/** Only differs proves PID reuse; unproven means wall-clock drift may explain the mismatch. */
export type HelixdProcessIdentityVerdict = 'matches' | 'differs' | 'unknown' | 'unproven'

export type HelixdProcessIdentityReaders = {
  startedAtMs?: (pid: number) => number | null
  incarnation?: (pid: number) => HelixdProcessIncarnation | null
  ownerUid?: (pid: number) => number | null
  platform?: NodeJS.Platform
}

export function readHelixdProcessStartedAtMs(pid: number): number | null {
  return process.platform === 'win32'
    ? readWindowsProcessCreationTime(pid)
    : getProcessStartedAtMs(pid)
}

/** Linux start ticks and boot ID are independent of wall-clock adjustments. */
export function readHelixdProcessIncarnation(pid: number): HelixdProcessIncarnation | null {
  if (process.platform !== 'linux') {
    return null
  }
  try {
    const linuxStartTicks = parseLinuxStartTicks(readFileSync(`/proc/${pid}/stat`, 'utf8'))
    const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
    return linuxStartTicks && /^\d+$/.test(linuxStartTicks) && bootId
      ? { linuxStartTicks, bootId }
      : null
  } catch {
    return null
  }
}

/** Non-dumpable Linux processes may appear owned by root. */
export function readHelixdProcessOwnerUid(pid: number): number | null {
  try {
    return statSync(`/proc/${pid}`).uid
  } catch {
    return null
  }
}

export function readHelixdProcessName(pid: number): string | null {
  try {
    const name = readFileSync(`/proc/${pid}/comm`, 'utf8')
      .trim()
      .replace(/[^\x20-\x7e]/g, '?')
    return name || null
  } catch {
    return null
  }
}

function readLinuxOverflowUid(): number {
  try {
    const uid = Number(readFileSync('/proc/sys/kernel/overflowuid', 'utf8').trim())
    return Number.isSafeInteger(uid) ? uid : 65534
  } catch {
    return 65534
  }
}

/** Different uid proves reuse except root/overflow, which may mask non-dumpable or unmapped owners. */
function ownerProvesAnotherProcess(
  pid: number,
  recorded: HelixdRecordedIdentity,
  readers: HelixdProcessIdentityReaders
): boolean {
  if (!recorded.identity || !/^\d+$/.test(recorded.identity)) {
    return false
  }
  const owner = (readers.ownerUid ?? readHelixdProcessOwnerUid)(pid)
  return (
    owner !== null &&
    owner !== 0 &&
    owner !== Number(recorded.identity) &&
    owner !== readLinuxOverflowUid()
  )
}

export function recordedHelixdProcessIncarnation(
  recorded: HelixdRecordedIdentity
): HelixdProcessIncarnation | null {
  return recorded.linuxStartTicks && recorded.bootId
    ? { linuxStartTicks: recorded.linuxStartTicks, bootId: recorded.bootId }
    : null
}

export function compareHelixdProcessIdentity(
  pid: number,
  recorded: HelixdRecordedIdentity,
  readers: HelixdProcessIdentityReaders = {}
): HelixdProcessIdentityVerdict {
  const expected = recordedHelixdProcessIncarnation(recorded)
  if (expected) {
    const actual = (readers.incarnation ?? readHelixdProcessIncarnation)(pid)
    if (!actual) {
      return 'unknown'
    }
    return actual.bootId === expected.bootId && actual.linuxStartTicks === expected.linuxStartTicks
      ? 'matches'
      : 'differs'
  }
  const actual = (readers.startedAtMs ?? readHelixdProcessStartedAtMs)(pid)
  if (actual === null || recorded.startedAtMs === null) {
    return 'unknown'
  }
  if (startTimesWithinTolerance(actual, recorded.startedAtMs, START_TIME_TOLERANCE_MS)) {
    return 'matches'
  }
  // Only Linux recomputes creation time from a drifting btime.
  if ((readers.platform ?? process.platform) !== 'linux') {
    return 'differs'
  }
  return ownerProvesAnotherProcess(pid, recorded, readers) ? 'differs' : 'unproven'
}
