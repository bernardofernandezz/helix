// Redirect detached candidate stdout to its version directory so readiness does not hold SSH open.
import type { HelixdLaunchEnvEntry } from '../../ssh/helixd-host-transport'
import {
  HELIXD_LAUNCHER_FILENAME,
  HELIXD_SERVER_ENTRY_FILENAME
} from '../../../shared/helixd-artifacts'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  remoteBasename,
  remoteDirname,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import { HELIXD_WSL_HOST_ENV } from '../../ipc/wsl-guest-windows-drive-path'
import {
  assertPosixHelixdHost as assertPosixHost,
  HELIXD_LOG_FILENAME,
  HELIXD_PID_FILENAME,
  HELIXD_LAUNCH_MACHINE_COMMAND,
  HELIXD_PID_MACHINE_FILENAME,
  HELIXD_READINESS_FILENAME,
  HELIXD_READINESS_MAX_BYTES,
  posixProcessAliveShellFunction
} from './helixd-remote-host-support'
import type { ServeReadiness } from '../../server/serve-readiness'
import { selectHelixdSlotRuntimeCommand } from './helixd-remote-runtime'
import { HELIXD_STOP_REQUEST_FILENAME } from '../../../shared/helixd-stop-request'
import { helixdWindowsSlotOpCommand } from './helixd-remote-windows-node'
import {
  captureHelixdLaunchSshSessionCommand,
  recordsHelixdLaunchSshSession,
  writeHelixdLaunchSshSessionCommand
} from '../../ssh/helixd-launch-ssh-session'
import {
  HELIXD_E2E_IDLE_TIMEOUT_ENV,
  readHelixdE2EIdleTimeoutMs
} from '../../../shared/helixd-idle-exit'
import { HELIXD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../shared/helixd-managed-launch-env'

export type HelixdLaunchSpec = {
  remoteInstallDir: string
  nodePath: string
  fullVersion: string
  /** Shared across versions; rollback requires a snapshot. */
  userDataDir: string
  bindHost: string
  port: number
  /** Shared activation fence; managed SSH launches may idle out. */
  activationRoot: string
}

/** Older helixd versions ignore these launch variables. */
export function helixdManagedLaunchEnv(
  spec: HelixdLaunchSpec,
  env: NodeJS.ProcessEnv = process.env
): [string, string][] {
  const e2eTimeout = readHelixdE2EIdleTimeoutMs(env)
  return [
    [HELIXD_MANAGED_ACTIVATION_ROOT_ENV, spec.activationRoot],
    ...(e2eTimeout === null
      ? []
      : [[HELIXD_E2E_IDLE_TIMEOUT_ENV, String(e2eTimeout)] satisfies [string, string]])
  ]
}

/** WSL without systemd kills nohup children with wsl.exe --exec; use a separate session. */
export type HelixdLaunchDetach = 'nohup' | 'setsid'

const HELIXD_SETSID_PID_WAIT_TRIES = 100

/** Halving V8's 16 MB semi-spaces saves ~30 MB idle RSS; a CLI flag because the heap cannot be resized later. */
export const HELIXD_RUNTIME_V8_FLAGS = '--max-semi-space-size=8'

/** Pass bind explicitly so launch policy cannot change with installed-version defaults. */
export function helixdLaunchCommand(
  host: RemoteHostPlatform,
  spec: HelixdLaunchSpec,
  detach: HelixdLaunchDetach = 'nohup',
  hostEnv: readonly HelixdLaunchEnvEntry[] = []
): string {
  assertPosixHost(host)
  const dir = quotePosixShell(spec.remoteInstallDir)
  // Relative artifact paths reduce command size; every use follows the same-shell cd.
  const readiness = quotePosixShell(HELIXD_READINESS_FILENAME)
  const log = quotePosixShell(HELIXD_LOG_FILENAME)
  // PID writes run outside nohup’s backgrounded cd; reuse one absolute path to stay within command budgets.
  const pidFile = '"$helixd_pid"'
  // Liveness matches runtime argv against the absolute entry path.
  const entry = quotePosixShell(
    joinRemotePath(host, spec.remoteInstallDir, HELIXD_LAUNCHER_FILENAME)
  )
  const baseDir = remoteDirname(spec.remoteInstallDir.replace(/\/+$/u, ''), host)
  // Tighten only the managed root, never an unrelated custom-slot parent.
  const privateDirs = [
    ...(remoteBasename(baseDir, host) === RELAY_REMOTE_DIR ? [baseDir] : []),
    spec.remoteInstallDir
  ]
  // Capture in the launching shell; detached subshell variables do not return here.
  const recordSession = detach === 'nohup' && recordsHelixdLaunchSshSession(host)
  const launchEnv = [
    `HELIX_VERSION=${quotePosixShell(spec.fullVersion)}`,
    `HELIX_USER_DATA=${quotePosixShell(spec.userDataDir)}`,
    ...helixdManagedLaunchEnv(spec).map(([name, value]) => `${name}=${quotePosixShell(value)}`)
  ]
  return [
    `helixd_pid=${quotePosixShell(joinRemotePath(host, spec.remoteInstallDir, HELIXD_PID_FILENAME))};`,
    // Record the launching machine before detaching; absent boot identity leaves it unverified.
    `{ ${HELIXD_LAUNCH_MACHINE_COMMAND};}>"$helixd_pid${HELIXD_PID_MACHINE_FILENAME.slice(HELIXD_PID_FILENAME.length)}" 2>/dev/null;`,
    ...(recordSession ? [captureHelixdLaunchSshSessionCommand()] : []),
    // Preserve login umask for daemon children creating user files.
    'helixd_login_umask=$(umask);',
    // Pairing-token artifacts need umask 077 from creation; semicolon also covers the external PID write.
    'umask 077;',
    // Tighten existing artifacts best-effort; umask cannot repair their modes.
    `{ chmod 700 ${privateDirs.map(quotePosixShell).join(' ')} 2>/dev/null || :; } &&`,
    `cd ${dir} &&`,
    `${selectHelixdSlotRuntimeCommand(host, spec.remoteInstallDir, spec.nodePath)} &&`,
    // Truncate so relaunch cannot activate on the previous process’s readiness.
    `: > ${readiness} &&`,
    // Required: truncating redirects retain old file modes.
    `chmod 600 ${readiness} &&`,
    `{ chmod 600 ${pidFile} ${log} 2>/dev/null || :; } &&`,
    `rm -f ${quotePosixShell(HELIXD_STOP_REQUEST_FILENAME)} &&`,
    ...(detach === 'setsid' ? [`rm -f ${pidFile} &&`] : []),
    ...(detach === 'setsid'
      ? setsidLaunchTail(entry, spec, readiness, log, pidFile, launchEnv, hostEnv)
      : [
          // Open redirects under 077 before restoring daemon login umask.
          '{ umask "$helixd_login_umask" &&',
          ...launchEnv,
          // exec keeps $! equal to runtime PID; in-place launcher loading also preserves older clients’ argv checks.
          `exec nohup "$helixd_runtime" ${HELIXD_RUNTIME_V8_FLAGS} ${entry}`,
          `--json --bind ${quotePosixShell(spec.bindHost)} --port ${String(spec.port)};`,
          `} > ${readiness} 2>> ${log} < /dev/null &`,
          `echo $! > ${pidFile} &&`,
          ...(recordSession
            ? [`${writeHelixdLaunchSshSessionCommand(host, spec.userDataDir)} &&`]
            : []),
          `cat ${pidFile}`
        ])
  ].join(' ')
}

/** setsid -f exits its parent, so the exec child records $$; BusyBox uses background setsid without -f. */
function setsidLaunchTail(
  entry: string,
  spec: HelixdLaunchSpec,
  readiness: string,
  log: string,
  pidFile: string,
  launchEnv: readonly string[],
  hostEnv: readonly HelixdLaunchEnvEntry[]
): string[] {
  return [
    ...launchEnv,
    // Only WSL setsid launches receive this marker.
    `${HELIXD_WSL_HOST_ENV}=1`,
    ...hostEnv.map(([name, value]) => `${assertEnvName(name)}=${quotePosixShell(value)}`),
    'sh -c \'helixd_detach() { if setsid -f true >/dev/null 2>&1; then setsid -f "$@"; ' +
      'else setsid "$@" & fi; }; helixd_detach "$@"\' helixd-detach',
    `sh -c 'echo $$ > "$1" && umask "$2" && shift 2 && exec "$@"' helixd-launch ${pidFile}`,
    '"$helixd_login_umask"',
    `"$helixd_runtime" ${HELIXD_RUNTIME_V8_FLAGS} ${entry}`,
    `--json --bind ${quotePosixShell(spec.bindHost)} --port ${String(spec.port)}`,
    `> ${readiness} 2>> ${log} < /dev/null &&`,
    `helixd_wait=0; while [ ! -s ${pidFile} ] && [ "$helixd_wait" -lt ${HELIXD_SETSID_PID_WAIT_TRIES} ];`,
    'do sleep 0.05; helixd_wait=$((helixd_wait + 1)); done;',
    `cat ${pidFile}`
  ]
}

function assertEnvName(name: string): string {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    throw new Error(`helixd_launch_env_name_invalid:${name}`)
  }
  return name
}

export function readHelixdReadinessCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  assertPosixHost(host)
  const readiness = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, HELIXD_READINESS_FILENAME)
  )
  return `head -c ${HELIXD_READINESS_MAX_BYTES + 1} ${readiness} 2>/dev/null || true`
}

/** LIVE/DEAD/UNKNOWN distinguish proven state from missing/denied identity probes.
 * No PID or readiness file means NEVER_LAUNCHED, which also proves this slot has no process. */
export function helixdLivenessProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  if (isWindowsRemoteHost(host)) {
    return helixdWindowsSlotOpCommand(host, remoteInstallDir, 'liveness', [remoteInstallDir])
  }
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, HELIXD_PID_FILENAME))
  const readiness = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, HELIXD_READINESS_FILENAME)
  )
  const launcher = quotePosixShell(joinRemotePath(host, remoteInstallDir, HELIXD_LAUNCHER_FILENAME))
  const server = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, HELIXD_SERVER_ENTRY_FILENAME)
  )
  return [
    posixProcessAliveShellFunction({ refuseUnverifiable: true }),
    // PID reuse needs argv identity; absent ps leaves conservative liveness checks to decide.
    `helixd_launcher=${launcher}; helixd_server=${server};`,
    // The probe's own shell, or the shell wrapping it, carries the slot paths in its argv; after a
    // restart either can hold the old PID. A shell elsewhere may be an older launcher's live parent.
    'helixd_reused() { { [ "$1" = "$$" ] || [ "$1" = "$PPID" ]; } && return 0; ' +
      'args=$(ps -o args= -p "$1" 2>/dev/null) && [ -n "$args" ] && ' +
      'case "$args" in *"$helixd_launcher"* | *"$helixd_server"*) return 1;; *) return 0;; esac; };',
    `pid=$(cat ${pidFile} 2>/dev/null);`,
    'case "$pid" in',
    `"" ) if [ -e ${pidFile} ] || [ -e ${readiness} ]; then echo UNKNOWN; else echo ${HELIXD_NEVER_LAUNCHED}; fi;;`,
    '*[!0-9]* ) echo UNKNOWN;;',
    '* ) if helixd_reused "$pid"; then echo DEAD; elif helixd_alive "$pid"; then echo LIVE; else echo DEAD; fi;;',
    'esac'
  ].join(' ')
}

export const HELIXD_NEVER_LAUNCHED = 'NEVER_LAUNCHED'

export type HelixdLiveness = 'LIVE' | 'DEAD' | 'UNKNOWN' | typeof HELIXD_NEVER_LAUNCHED

export function parseHelixdLiveness(output: string): HelixdLiveness {
  const value = output.trim().split('\n').pop()?.trim()
  return value === 'LIVE' || value === 'DEAD' || value === HELIXD_NEVER_LAUNCHED ? value : 'UNKNOWN'
}

/** Only DEAD/NEVER_LAUNCHED permit lifecycle changes; UNKNOWN proves nothing. */
export function helixdLivenessProvenExited(liveness: HelixdLiveness): boolean {
  return liveness === 'DEAD' || liveness === HELIXD_NEVER_LAUNCHED
}

export function helixdLivenessAnswerBlocksGc(output: string): boolean {
  return helixdLivenessBlocksGc(parseHelixdLiveness(output))
}

export function helixdLivenessBlocksGc(liveness: HelixdLiveness): boolean {
  return !helixdLivenessProvenExited(liveness)
}

export type HelixdReadinessParse =
  | { state: 'ready'; readiness: ServeReadiness }
  | { state: 'pending' }
  | { state: 'malformed'; reason: string }

/** Treat an unfinished last line as pending; polling can race a candidate stdout append. */
export function parseHelixdReadinessOutput(raw: string): HelixdReadinessParse {
  if (Buffer.byteLength(raw, 'utf8') > HELIXD_READINESS_MAX_BYTES) {
    return { state: 'malformed', reason: 'readiness payload exceeds the 256 KiB limit' }
  }
  const lines = raw.split('\n')
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Only an unterminated last line can recover from a partial write.
      return index === lines.length - 1
        ? { state: 'pending' }
        : { state: 'malformed', reason: 'readiness line is not valid JSON' }
    }
    if (typeof parsed !== 'object' || parsed === null) {
      continue
    }
    const payload = parsed as { type?: unknown }
    if (payload.type !== 'helix_server_ready') {
      return {
        state: 'malformed',
        reason: `expected an helix_server_ready line, got type=${JSON.stringify(payload.type)}`
      }
    }
    return { state: 'ready', readiness: toServeReadiness(payload as Record<string, unknown>) }
  }
  return { state: 'pending' }
}

function toServeReadiness(payload: Record<string, unknown>): ServeReadiness {
  return {
    runtimeId: typeof payload.runtimeId === 'string' ? payload.runtimeId : '',
    boundEndpoint: typeof payload.boundEndpoint === 'string' ? payload.boundEndpoint : null,
    advertisedEndpoint:
      typeof payload.advertisedEndpoint === 'string' ? payload.advertisedEndpoint : null,
    managedWslCliReconciliation:
      payload.managedWslCliReconciliation === 'pending' ||
      payload.managedWslCliReconciliation === 'failed'
        ? payload.managedWslCliReconciliation
        : 'settled',
    pairing: payload.pairing as ServeReadiness['pairing'],
    ...(payload.health ? { health: payload.health as ServeReadiness['health'] } : {})
  }
}
