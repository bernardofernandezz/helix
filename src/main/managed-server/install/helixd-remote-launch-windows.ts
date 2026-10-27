// Win32-OpenSSH kills session jobs; require native breakaway without WMI/PowerShell, then record PID plus creation time.
import {
  HELIXD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_ENV_FLAG,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
  WINDOWS_BREAKAWAY_STDERR_FLAG,
  WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
  WINDOWS_BREAKAWAY_STDOUT_FLAG
} from '../../../shared/windows-breakaway-launch'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  helixdWindowsNodeCommandLine,
  helixdWindowsSlotOpCommand,
  readHelixdWindowsEncodedAnswer
} from './helixd-remote-windows-node'
import {
  HELIXD_WINDOWS_ENTRY_MARKER,
  HELIXD_WINDOWS_RUNTIME_MARKER
} from '../host-state/helixd-windows-host-script'
import {
  HELIXD_LOG_FILENAME,
  HELIXD_READINESS_FILENAME,
  HELIXD_WINDOWS_PROCESS_FILENAME
} from './helixd-remote-host-support'
import { helixdManagedLaunchEnv, type HelixdLaunchSpec } from './helixd-remote-launch'
import { HELIXD_WINDOWS_LAUNCH_REFUSED_CODE } from '../../helixd/helixd-host-unavailable'

export class HelixdWindowsLaunchRefusedError extends Error {
  readonly code = HELIXD_WINDOWS_LAUNCH_REFUSED_CODE
  constructor(reason: string) {
    super(
      `The Windows host refused to start helixd outside the SSH session (${reason}). helixd needs ` +
        'a job that allows breakaway and a slot with the process-tree launcher; it never falls ' +
        'back to WMI.'
    )
    this.name = 'HelixdWindowsLaunchRefusedError'
  }
}

/** Resolve pinned slot runtime and remove stale instance-stop intent before launch. */
export function windowsHelixdLaunchRuntimeCommand(
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return helixdWindowsSlotOpCommand(host, slotDir, 'slot-runtime', [slotDir, 'clear-stop-request'])
}

export function readWindowsHelixdSlotRuntime(output: string): string {
  const runtime = readHelixdWindowsEncodedAnswer(output, HELIXD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this helixd slot needs.')
  }
  return runtime
}

/** Older host scripts omit entry, implying the legacy single-file launcher. */
export function readWindowsHelixdSlotEntry(
  output: string,
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return (
    readHelixdWindowsEncodedAnswer(output, HELIXD_WINDOWS_ENTRY_MARKER) ??
    joinRemotePath(host, slotDir, 'helixd.js')
  )
}

export function windowsHelixdLaunchCommand(
  host: RemoteHostPlatform,
  spec: HelixdLaunchSpec,
  slotRuntime: string,
  slotEntry = joinRemotePath(host, spec.remoteInstallDir, 'helixd.js')
): string {
  const dir = spec.remoteInstallDir
  return helixdWindowsNodeCommandLine(slotRuntime, [
    slotEntry,
    WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    // CREATE_ALWAYS removes stale readiness before the launcher returns.
    WINDOWS_BREAKAWAY_STDOUT_FLAG,
    joinRemotePath(host, dir, HELIXD_READINESS_FILENAME),
    WINDOWS_BREAKAWAY_STDERR_FLAG,
    joinRemotePath(host, dir, HELIXD_LOG_FILENAME),
    // Preserve previous stderr for crash diagnosis across restart.
    WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
    WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
    joinRemotePath(host, dir, HELIXD_WINDOWS_PROCESS_FILENAME),
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `HELIX_VERSION=${spec.fullVersion}`,
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `HELIX_USER_DATA=${spec.userDataDir}`,
    ...helixdManagedLaunchEnv(spec).flatMap(([name, value]) => [
      WINDOWS_BREAKAWAY_ENV_FLAG,
      `${name}=${value}`
    ]),
    HELIXD_WINDOWS_BREAKAWAY_CONTRACT.argsFlag,
    '--json',
    '--bind',
    spec.bindHost,
    '--port',
    String(spec.port)
  ])
}

/** Return launched PID or surface native-breakaway refusal/failure. */
export function readWindowsHelixdLaunchReport(output: string): number {
  const report = parseWindowsBreakawayLaunchReport(HELIXD_WINDOWS_BREAKAWAY_CONTRACT, output)
  if (report?.method === 'breakaway') {
    return report.pid
  }
  if (report?.method === 'unavailable') {
    throw new HelixdWindowsLaunchRefusedError(
      report.step ? `${report.reason} at ${report.step}` : report.reason
    )
  }
  const detail =
    report?.method === 'failed'
      ? `${report.reason}${report.step ? ` at ${report.step}` : ''} (code ${String(report.code ?? 0)})`
      : 'no launch report'
  throw new Error(`helixd's Windows launcher did not start the candidate: ${detail}.`)
}
