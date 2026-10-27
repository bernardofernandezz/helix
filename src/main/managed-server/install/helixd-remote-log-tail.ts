// Decorate logged errors with a bounded redacted host tail, never telemetry; missing host evidence preserves the original failure.
import { redactString } from '../../observability/redactor'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { HELIXD_LOG_FILENAME } from './helixd-remote-host-support'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import {
  helixdWindowsSlotOpCommand,
  readHelixdWindowsEncodedAnswer
} from './helixd-remote-windows-node'
import { HELIXD_WINDOWS_LOG_TAIL_MARKER } from '../host-state/helixd-windows-host-script'
import type { HelixdRemoteExecTarget } from './helixd-remote-runtime-control'

export const HELIXD_LOG_TAIL_LINES = 40
export const HELIXD_LOG_TAIL_MAX_BYTES = 8 * 1024
// Error decoration must not add an unbounded delay.
const HELIXD_LOG_TAIL_TIMEOUT_MS = 10_000

export function helixdLogTailCommand(host: RemoteHostPlatform, slotDir: string): string {
  const log = joinRemotePath(host, slotDir, HELIXD_LOG_FILENAME)
  if (isWindowsRemoteHost(host)) {
    return helixdWindowsSlotOpCommand(host, slotDir, 'log-tail', [
      log,
      String(HELIXD_LOG_TAIL_MAX_BYTES)
    ])
  }
  return `tail -c ${HELIXD_LOG_TAIL_MAX_BYTES} ${quotePosixShell(log)} 2>/dev/null || true`
}

export function parseHelixdLogTail(host: RemoteHostPlatform, output: string): string | null {
  const raw = isWindowsRemoteHost(host)
    ? (readHelixdWindowsEncodedAnswer(output, HELIXD_WINDOWS_LOG_TAIL_MARKER) ?? '')
    : output
  const bounded = Buffer.from(raw, 'utf8').subarray(-HELIXD_LOG_TAIL_MAX_BYTES).toString('utf8')
  const lines = bounded.replace(/\s+$/u, '').split(/\r?\n/u).slice(-HELIXD_LOG_TAIL_LINES)
  const tail = redactString(lines.join('\n'))
  return tail.trim() ? tail : null
}

async function readHelixdLogTail(
  target: HelixdRemoteExecTarget,
  slotDir: string
): Promise<string | null> {
  try {
    // Observe cancellation failures without reusing the already-aborted request signal.
    const output = await execCommand(target.conn, helixdLogTailCommand(target.host, slotDir), {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: HELIXD_LOG_TAIL_TIMEOUT_MS
    })
    return parseHelixdLogTail(target.host, output)
  } catch (error) {
    console.warn('[ssh] Could not read the helixd.log tail:', error)
    return null
  }
}

export async function withHelixdLogTail(
  target: HelixdRemoteExecTarget,
  slotDir: string,
  message: string
): Promise<string> {
  const tail = await readHelixdLogTail(target, slotDir)
  return tail ? `${message}\nLast lines of helixd.log:\n${tail}` : message
}
