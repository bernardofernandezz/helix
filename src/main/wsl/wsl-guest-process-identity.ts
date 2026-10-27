/** Use kernel boot ID and /proc start ticks for distro/process identity; wall-clock jumps after host sleep can misidentify live processes (microsoft/WSL#4179/#10006). */
import type { HelixdProcessIncarnation } from '../helixd/helixd-process-start-time'
import type { HelixdHostTransport } from '../ssh/helixd-host-transport'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'

export type WslGuestIdentity = {
  /** `<boot_id>:<pid 1 start ticks>`; a distro restart (or a VM restart) changes it. */
  distroInstance: string
  /** helixd's `<pid>:<start ticks>`; null when no pid was asked for or the process is gone. */
  helixd: string | null
}

const SECTION = '--helix-identity--'
const IDENTITY_TIMEOUT_MS = 10_000

/** One exec, so a classification never mixes two distro incarnations. */
export function wslGuestIdentityCommand(helixdPid: number | null): string {
  const helixd =
    helixdPid !== null && Number.isSafeInteger(helixdPid) && helixdPid > 0
      ? `cat /proc/${helixdPid}/stat 2>/dev/null; `
      : ''
  return [
    `cat /proc/sys/kernel/random/boot_id; echo ${SECTION}; cat /proc/1/stat; echo ${SECTION}; `,
    `${helixd}echo ${SECTION}`
  ].join('')
}

/** Field 22 of `/proc/<pid>/stat`; the name in field 2 may hold spaces and parentheses. */
export function procStatStartTicks(stat: string): string | null {
  const nameEnd = stat.lastIndexOf(')')
  if (nameEnd === -1) {
    return null
  }
  const fields = stat
    .slice(nameEnd + 1)
    .trim()
    .split(/\s+/)
  // Fields after the name start at field 3 (state), so field 22 sits at index 19.
  const ticks = fields[19]
  return ticks && /^\d+$/.test(ticks) ? ticks : null
}

function procStatPid(stat: string): string | null {
  const pid = /^\s*(\d+)\s+\(/.exec(stat)?.[1]
  return pid ?? null
}

export function parseWslGuestIdentity(output: string): WslGuestIdentity | null {
  const sections = output.split(SECTION)
  if (sections.length < 4) {
    return null
  }
  const bootId = sections[0].trim().split(/\s+/).at(-1) ?? ''
  const initTicks = procStatStartTicks(sections[1])
  if (!/^[0-9a-f-]{36}$/i.test(bootId) || !initTicks) {
    return null
  }
  const helixdStat = sections[2].trim()
  const helixdPid = helixdStat ? procStatPid(helixdStat) : null
  const helixdTicks = helixdStat ? procStatStartTicks(helixdStat) : null
  return {
    distroInstance: `${bootId.toLowerCase()}:${initTicks}`,
    helixd: helixdPid && helixdTicks ? `${helixdPid}:${helixdTicks}` : null
  }
}

/** The asked-for PID's identity in the form helixd's instance lock records; null when it is gone. */
export function wslGuestHelixdIncarnation(
  identity: WslGuestIdentity
): HelixdProcessIncarnation | null {
  const linuxStartTicks = identity.helixd?.split(':')[1]
  const bootId = identity.distroInstance.split(':')[0]
  return linuxStartTicks && bootId ? { linuxStartTicks, bootId } : null
}

/** null when the guest could not answer: that is unverifiable, never evidence of an exit. */
export async function readWslGuestIdentity(
  conn: HelixdHostTransport,
  helixdPid: number | null
): Promise<WslGuestIdentity | null> {
  try {
    return parseWslGuestIdentity(
      await execCommand(conn, wslGuestIdentityCommand(helixdPid), {
        timeoutMs: IDENTITY_TIMEOUT_MS
      })
    )
  } catch {
    return null
  }
}
