import { randomUUID } from 'node:crypto'
import { HELIXD_NODE_RUNTIME_IDENTITY } from '../../../shared/helixd-node-runtime-identity'
import { HELIXD_NODE_RUNTIME_MARKER_FILENAME } from '../../../shared/helixd-artifacts'
import {
  HELIXD_PROFILE_PREFLIGHT_FLAG,
  HELIXD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseHelixdProfilePreflight
} from '../../../shared/helixd-profile-preflight'
import { assertPosixHelixdHost } from './helixd-remote-host-support'
import {
  helixdWindowsNodeCommandLine,
  helixdWindowsSlotOpCommand,
  readHelixdWindowsEncodedAnswer
} from './helixd-remote-windows-node'
import { readWindowsHelixdSlotEntry } from './helixd-remote-launch-windows'
import { HELIXD_WINDOWS_RUNTIME_MARKER } from '../host-state/helixd-windows-host-script'
import { helixdNodeSlotRuntimeCommand, selectHelixdSlotEntryCommand } from './helixd-remote-runtime'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'

export function helixdProfilePreflightCommand(
  host: RemoteHostPlatform,
  directory: string,
  nonce: string
): string {
  assertPosixHelixdHost(host)
  // New candidates always use pinned Node; host Node fallback could mask an incomplete slot.
  const marker = quotePosixShell(
    joinRemotePath(host, directory, HELIXD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const launch = [
    'HELIX_BACKGROUND_LAUNCH=1',
    '"$helixd_runtime"',
    '"$helixd_entry"',
    HELIXD_PROFILE_PREFLIGHT_FLAG,
    quotePosixShell(nonce)
  ].join(' ')
  return `[ -e ${marker} ] || exit 78; ${helixdNodeSlotRuntimeCommand(host, directory)}${selectHelixdSlotEntryCommand(host, directory)}; ${launch}`
}

export async function preflightInstalledHelixd(options: {
  conn: HelixdHostTransport
  host: RemoteHostPlatform
  remoteInstallDir: string
  fullVersion: string
  signal?: AbortSignal
}): Promise<void> {
  const nonce = randomUUID()
  const command = isWindowsRemoteHost(options.host)
    ? await windowsHelixdProfilePreflightCommand(options, nonce)
    : helixdProfilePreflightCommand(options.host, options.remoteInstallDir, nonce)
  const output = await execCommand(options.conn, command, {
    signal: options.signal,
    timeoutMs: HELIXD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    wrapCommand: !isWindowsRemoteHost(options.host)
  })
  parseHelixdProfilePreflight(output, nonce, HELIXD_NODE_RUNTIME_IDENTITY, options.fullVersion)
}

// Windows uses plain argv; helixd opens no window and needs no background-launch environment.
async function windowsHelixdProfilePreflightCommand(
  options: {
    conn: HelixdHostTransport
    host: RemoteHostPlatform
    remoteInstallDir: string
    signal?: AbortSignal
  },
  nonce: string
): Promise<string> {
  const { host, remoteInstallDir } = options
  const slotAnswer = await execCommand(
    options.conn,
    helixdWindowsSlotOpCommand(host, remoteInstallDir, 'slot-runtime', [remoteInstallDir]),
    { signal: options.signal, wrapCommand: false }
  )
  const runtime = readHelixdWindowsEncodedAnswer(slotAnswer, HELIXD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this helixd slot needs.')
  }
  return helixdWindowsNodeCommandLine(runtime, [
    readWindowsHelixdSlotEntry(slotAnswer, host, remoteInstallDir),
    HELIXD_PROFILE_PREFLIGHT_FLAG,
    nonce
  ])
}
