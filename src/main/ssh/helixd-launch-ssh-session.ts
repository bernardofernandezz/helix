/** macOS pins Local Network attribution at spawn: SSH-launched terminals can lose LAN access after sshd-session exits (; Apple TN3179). Record the nearest session plus start time and matching slot PID; preserve earlier attribution while a live terminal daemon survives helixd restarts. */
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { HELIXD_PID_FILENAME } from '../managed-server/install/helixd-remote-host-support'

export const HELIXD_LAUNCH_SSH_SESSION_FILENAME = '.helixd-launch-ssh-session'

const LOCAL_NETWORK_PRIVACY_MAJOR = 15
// Bounds the ancestor walk; real chains are a few processes deep.
const MAX_ANCESTOR_DEPTH = 32

export function recordsHelixdLaunchSshSession(host: RemoteHostPlatform): boolean {
  return host.os === 'darwin'
}

/** Choose the nearest sshd ancestor, which exits with this session; a listener farther up would remain alive. */
export function helixdSshSessionAncestorShellFunction(): string {
  return (
    'helixd_ssh_session() { helixd_sp=$1; helixd_si=0; ' +
    `while [ "$helixd_si" -lt ${MAX_ANCESTOR_DEPTH} ]; do ` +
    'case "$helixd_sp" in "" | *[!0-9]* | 0 | 1) return 1;; esac; ' +
    'helixd_sc=$(ps -o comm= -p "$helixd_sp" 2>/dev/null) || return 1; ' +
    'case "${helixd_sc##*/}" in sshd*) ' +
    'helixd_ss=$(ps -o lstart= -p "$helixd_sp" 2>/dev/null) || return 1; ' +
    // Why unquoted: normalizes lstart's padding so a later read compares equal.
    'echo "$helixd_sp" $helixd_ss; return 0;; esac; ' +
    'helixd_sp=$(ps -o ppid= -p "$helixd_sp" 2>/dev/null | tr -d " "); ' +
    'helixd_si=$((helixd_si + 1)); done; return 1; };'
  )
}

/** Capture before detach without failing launch. */
export function captureHelixdLaunchSshSessionCommand(): string {
  return (
    `${helixdSshSessionAncestorShellFunction()} ` +
    'helixd_session=$(helixd_ssh_session "$$" 2>/dev/null) || helixd_session=;'
  )
}

function recordPath(host: RemoteHostPlatform, userDataDir: string): string {
  return quotePosixShell(joinRemotePath(host, userDataDir, HELIXD_LAUNCH_SSH_SESSION_FILENAME))
}

/** Return 0 for this root's live daemon, 1 for absence, 2 for unreadable argv; PID files alone may name recycled processes. */
function liveDaemonShellFunction(host: RemoteHostPlatform, userDataDir: string): string {
  const daemonDir = quotePosixShell(joinRemotePath(host, userDataDir, 'daemon'))
  return (
    `helixd_daemon_live() { helixd_ddir=${daemonDir}; for helixd_df in "$helixd_ddir"/daemon-v*.pid; do ` +
    '[ -f "$helixd_df" ] || continue; ' +
    'helixd_dp=$(sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\' "$helixd_df" | head -n 1); ' +
    '[ -n "$helixd_dp" ] || continue; ' +
    'kill -0 "$helixd_dp" 2>/dev/null || continue; ' +
    'helixd_da=$(ps -o args= -p "$helixd_dp" 2>/dev/null); [ -n "$helixd_da" ] || return 2; ' +
    'case "$helixd_da" in *daemon-entry*"$helixd_ddir"* | *"$helixd_ddir"*daemon-entry*) return 0;; esac; ' +
    'done; return 1; };'
  )
}

/** After recording $!, preserve the live daemon's earlier session; otherwise record this launch's session. */
export function writeHelixdLaunchSshSessionCommand(
  host: RemoteHostPlatform,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  return (
    // First-deploy detach may run before helixd creates its data root.
    `{ helixd_bg=$!; ( umask 077; mkdir -p ${quotePosixShell(userDataDir)} ); ` +
    `${liveDaemonShellFunction(host, userDataDir)} ` +
    'helixd_daemon_live; helixd_dl=$?; ' +
    'if [ "$helixd_dl" = 0 ]; then ' +
    `helixd_prev=$(cat ${file}); rm -f ${file}; set -- $helixd_prev; ` +
    `[ "$#" -lt 3 ] || { shift; ( umask 077; echo "$helixd_bg" "$@" > ${file} ); }; ` +
    // Unreadable daemon identity leaves attribution unknown, never assigned to this launch.
    `elif [ "$helixd_dl" = 2 ]; then rm -f ${file}; ` +
    `else rm -f ${file}; [ -z "$helixd_session" ] || ` +
    `( umask 077; echo "$helixd_bg" $helixd_session > ${file} ); fi; :; } 2>/dev/null`
  )
}

export function helixdLaunchSshSessionProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, HELIXD_PID_FILENAME))
  return [
    'helixd_mac=$(sw_vers -productVersion 2>/dev/null) || { echo NOT_APPLICABLE; exit 0; };',
    'helixd_major=${helixd_mac%%.*};',
    'case "$helixd_major" in "" | *[!0-9]*) echo UNVERIFIABLE; exit 0;; esac;',
    `[ "$helixd_major" -ge ${LOCAL_NETWORK_PRIVACY_MAJOR} ] || { echo NOT_APPLICABLE; exit 0; };`,
    `helixd_rec=$(cat ${file} 2>/dev/null) || { echo NOT_RECORDED; exit 0; };`,
    `helixd_pid=$(cat ${pidFile} 2>/dev/null);`,
    'set -- $helixd_rec;',
    'case "$1:$2" in *[!0-9:]* | :* | *:) echo NOT_RECORDED; exit 0;; esac;',
    '[ "$1" = "$helixd_pid" ] || { echo NOT_RECORDED; exit 0; };',
    'helixd_sshd=$2; shift 2; helixd_want=$*;',
    // A ps that can't list this shell can't prove another process absent.
    'ps -o pid= -p "$$" >/dev/null 2>&1 || { echo UNVERIFIABLE; exit 0; };',
    'helixd_now=$(ps -o lstart= -p "$helixd_sshd" 2>/dev/null); helixd_now=$(echo $helixd_now);',
    // A reused PID with another start time is a different process: the session is gone.
    'if [ -z "$helixd_now" ] || [ "$helixd_now" != "$helixd_want" ]; then echo EXITED; else echo LIVE; fi'
  ].join(' ')
}

/** `not-recorded` covers older launches and clients: the condition is unknown, never assumed. */
export type HelixdLaunchSshSession =
  | 'live'
  | 'exited'
  | 'unverifiable'
  | 'not-recorded'
  | 'not-applicable'

export function parseHelixdLaunchSshSession(output: string): HelixdLaunchSshSession {
  switch (output.trim().split('\n').pop()?.trim() ?? '') {
    case 'LIVE':
      return 'live'
    case 'EXITED':
      return 'exited'
    case 'NOT_RECORDED':
      return 'not-recorded'
    case 'NOT_APPLICABLE':
      return 'not-applicable'
    default:
      return 'unverifiable'
  }
}
