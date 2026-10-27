// Wait on-host in one bounded exec; repeated SSH polling spawned process bursts and triggered Windows EDR.
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import {
  HELIXD_PID_FILENAME,
  HELIXD_PID_MACHINE_FILENAME,
  HELIXD_READINESS_FILENAME,
  HELIXD_READINESS_MAX_BYTES,
  HELIXD_LAUNCH_MACHINE_COMMAND
} from './helixd-remote-host-support'
import {
  parseHelixdReadinessOutput,
  readHelixdReadinessCommand,
  type HelixdReadinessParse
} from './helixd-remote-launch'
import {
  helixdWindowsSlotOpCommand,
  readHelixdWindowsEncodedAnswer
} from './helixd-remote-windows-node'
import { HELIXD_WINDOWS_READINESS_MARKER } from '../host-state/helixd-windows-host-script'

// Stay below the 30-second exec timeout so waits can answer before channel expiry.
export const HELIXD_READINESS_WAIT_MAX_SECONDS = 20

const HELIXD_LAUNCH_EXITED_MARKER = 'HELIXD_LAUNCH_EXITED'

function posixReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const file = quotePosixShell(joinRemotePath(host, remoteInstallDir, HELIXD_READINESS_FILENAME))
  const read = `head -c ${HELIXD_READINESS_MAX_BYTES + 1} ${file} 2>/dev/null`
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, HELIXD_PID_FILENAME))
  const pidMachine = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, HELIXD_PID_MACHINE_FILENAME)
  )
  return [
    // Fail early only on proven exit from the launching machine; shared homes and unverified PIDs must keep waiting.
    `helixd_launch_here() { helixd_recorded=$(cat ${pidMachine} 2>/dev/null) && [ -n "$helixd_recorded" ] && [ "$helixd_recorded" = "$(${HELIXD_LAUNCH_MACHINE_COMMAND} 2>/dev/null)" ]; };`,
    `helixd_launch_exited() { helixd_launch_here || return 1; pid=$(cat ${pidFile} 2>/dev/null); case "$pid" in "" | *[!0-9]*) return 1;; esac;`,
    'probe_error=$(LC_ALL=C kill -0 "$pid" 2>&1) || { case "$probe_error" in *"No such process"*) return 0;; esac; return 1; };',
    'case "$(ps -o stat= -p "$pid" 2>/dev/null)" in Z*) return 0;; esac; return 1; };',
    // Probe fractional sleep once; POSIX hosts may support only integer seconds.
    'if sleep 0.25 2>/dev/null; then helixd_readiness_wait_step=0.25;',
    'else helixd_readiness_wait_step=1; fi;',
    // Bound elapsed time, not iterations: slow filesystem reads otherwise overrun the client exec deadline.
    `helixd_readiness_wait_end=$(($(date +%s) + ${waitSeconds}));`,
    'while [ "$(date +%s)" -lt "$helixd_readiness_wait_end" ]; do',
    `[ "$(${read} | wc -l)" -gt 0 ] && break;`,
    `[ "$(${read} | wc -c)" -gt ${HELIXD_READINESS_MAX_BYTES} ] && break;`,
    `helixd_launch_exited && { echo ${HELIXD_LAUNCH_EXITED_MARKER}; break; };`,
    'sleep "$helixd_readiness_wait_step"; done;',
    `${read} || true`
  ].join(' ')
}

export function helixdReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const seconds = Math.max(0, Math.min(HELIXD_READINESS_WAIT_MAX_SECONDS, Math.ceil(waitSeconds)))
  if (!isWindowsRemoteHost(host)) {
    return posixReadinessWaitCommand(host, remoteInstallDir, seconds)
  }
  return helixdWindowsSlotOpCommand(host, remoteInstallDir, 'readiness-wait', [
    joinRemotePath(host, remoteInstallDir, HELIXD_READINESS_FILENAME),
    String(HELIXD_READINESS_MAX_BYTES),
    String(seconds)
  ])
}

export function parseHelixdReadinessWaitOutput(
  host: RemoteHostPlatform,
  output: string
): HelixdReadinessParse {
  return parseHelixdReadinessOutput(
    isWindowsRemoteHost(host)
      ? (readHelixdWindowsEncodedAnswer(output, HELIXD_WINDOWS_READINESS_MARKER) ?? '')
      : withoutLaunchExitedMarker(output)
  )
}

export function helixdLaunchExitedDuringWait(host: RemoteHostPlatform, output: string): boolean {
  return !isWindowsRemoteHost(host) && output.startsWith(`${HELIXD_LAUNCH_EXITED_MARKER}\n`)
}

function withoutLaunchExitedMarker(output: string): string {
  return output.startsWith(`${HELIXD_LAUNCH_EXITED_MARKER}\n`)
    ? output.slice(HELIXD_LAUNCH_EXITED_MARKER.length + 1)
    : output
}

export function readHelixdReadinessNowCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  // Windows host wait with zero delay substitutes for the unavailable head command.
  return isWindowsRemoteHost(host)
    ? helixdReadinessWaitCommand(host, remoteInstallDir, 0)
    : readHelixdReadinessCommand(host, remoteInstallDir)
}
