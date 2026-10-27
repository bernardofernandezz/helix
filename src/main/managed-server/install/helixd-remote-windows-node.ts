// SSH DefaultShell may be cmd.exe or PowerShell; commands must parse identically in both.
import { currentHelixdFence } from '../activation/helixd-activation-fence-scope'
import { HELIXD_WINDOWS_FENCE_ARG } from '../host-state/helixd-windows-host-fence-ops'
import {
  HELIXD_NODE_RUNTIME_DIR_PREFIX,
  HELIXD_NODE_RUNTIME_WINDOWS_EXECUTABLE,
  HELIXD_RUNTIMES_DIRNAME
} from '../../../shared/helixd-artifacts'
import { pinnedNodeRuntimeAsset, type NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { randomUUID } from 'node:crypto'
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import {
  joinRemotePath,
  remoteDirname,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { quotePowerShellLiteral as powerShellLiteral } from '../../../shared/powershell-native-argument'
import { HELIXD_WINDOWS_COMMAND_LINE_UNSAFE_CODE } from '../../helixd/helixd-host-unavailable'
import {
  HELIXD_WINDOWS_HOST_SCRIPT,
  HELIXD_WINDOWS_HOST_SCRIPT_FILENAME,
  HELIXD_WINDOWS_HOST_SCRIPT_PRESENT,
  type HelixdWindowsHostOp
} from '../host-state/helixd-windows-host-script'

const BARE_EXECUTABLE = /^[A-Za-z]:\\[A-Za-z0-9._+~\\-]*$/u
// Leading digits are quoted: PowerShell would read `1e5` as a number and pass `100000`.
const BARE_ARGUMENT = /^[A-Za-z-][A-Za-z0-9._:+=/\\-]*$/u
// cmd.exe expands %; PowerShell expands $, backticks and typographic quotes inside double quotes.
const UNQUOTABLE = /["%$`\r\n\u201C\u201D\u201E\u2018\u2019\u201A\u201B]/u

export class HelixdWindowsCommandLineError extends Error {
  readonly code = HELIXD_WINDOWS_COMMAND_LINE_UNSAFE_CODE
  constructor(value: string) {
    super(
      `Helix cannot pass ${JSON.stringify(value)} to node.exe on this Windows host: it contains ` +
        'a character cmd.exe or PowerShell would expand.'
    )
    this.name = 'HelixdWindowsCommandLineError'
  }
}

function windowsPath(value: string): string {
  return value.replace(/\//gu, '\\')
}

function quotedArgument(value: string): string {
  if (BARE_ARGUMENT.test(value)) {
    return value
  }
  // A trailing backslash would escape the closing quote for CommandLineToArgvW.
  if (value === '' || UNQUOTABLE.test(value) || value.endsWith('\\')) {
    throw new HelixdWindowsCommandLineError(value)
  }
  return `"${value}"`
}

export function helixdWindowsNodeCommandLine(executable: string, args: readonly string[]): string {
  const program = windowsPath(executable)
  const argv = args.map(quotedArgument)
  if (BARE_EXECUTABLE.test(program)) {
    return [program, ...argv].join(' ')
  }
  // The inner line is single-quoted PowerShell inside one double-quoted argument both shells keep.
  for (const value of [program, ...args]) {
    if (UNQUOTABLE.test(value)) {
      throw new HelixdWindowsCommandLineError(value)
    }
  }
  const inner = ['&', ...[program, ...args].map(powerShellLiteral)].join(' ')
  return `powershell.exe -NoProfile -NonInteractive -Command "${inner}"`
}

export function helixdRemoteBaseDir(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR)
}

export function helixdWindowsBaseDir(host: RemoteHostPlatform, slotDir: string): string {
  return remoteDirname(slotDir.replace(/\/+$/u, ''), host)
}

export function helixdWindowsPinnedNodePath(host: RemoteHostPlatform, baseDir: string): string {
  const target: NodeRuntimeTarget = host.arch === 'arm64' ? 'win32-arm64' : 'win32-x64'
  return joinRemotePath(
    host,
    baseDir,
    HELIXD_RUNTIMES_DIRNAME,
    `${HELIXD_NODE_RUNTIME_DIR_PREFIX}${pinnedNodeRuntimeAsset(target).executableSha256}`,
    HELIXD_NODE_RUNTIME_WINDOWS_EXECUTABLE
  )
}

function helixdWindowsHostScriptPath(host: RemoteHostPlatform, baseDir: string): string {
  return joinRemotePath(host, baseDir, HELIXD_WINDOWS_HOST_SCRIPT_FILENAME)
}

export function helixdWindowsHostOpCommand(
  host: RemoteHostPlatform,
  baseDir: string,
  op: HelixdWindowsHostOp,
  args: readonly string[]
): string {
  const fence = currentHelixdFence()
  return helixdWindowsNodeCommandLine(helixdWindowsPinnedNodePath(host, baseDir), [
    helixdWindowsHostScriptPath(host, baseDir),
    ...(fence ? [HELIXD_WINDOWS_FENCE_ARG, fence.lockDir, fence.token] : []),
    op,
    ...args
  ])
}

export function helixdWindowsSlotOpCommand(
  host: RemoteHostPlatform,
  slotDir: string,
  op: HelixdWindowsHostOp,
  args: readonly string[]
): string {
  return helixdWindowsHostOpCommand(host, helixdWindowsBaseDir(host, slotDir), op, args)
}

export function helixdWindowsHomeOpCommand(
  host: RemoteHostPlatform,
  remoteHome: string,
  op: HelixdWindowsHostOp,
  args: readonly string[]
): string {
  return helixdWindowsHostOpCommand(host, helixdRemoteBaseDir(host, remoteHome), op, args)
}

const stagedHostScripts = new WeakMap<HelixdHostTransport, Set<string>>()

/** Content-addressed scripts publish atomically so concurrent readers never see truncated code. */
export async function installHelixdWindowsHostScript(
  target: { conn: HelixdHostTransport; host: RemoteHostPlatform; signal?: AbortSignal },
  baseDir: string
): Promise<void> {
  const scriptPath = helixdWindowsHostScriptPath(target.host, baseDir)
  const staged = stagedHostScripts.get(target.conn) ?? new Set<string>()
  stagedHostScripts.set(target.conn, staged)
  if (staged.has(scriptPath)) {
    return
  }
  // Run staged host-script ops rather than inline code.
  const runOp = async (
    script: string,
    op: HelixdWindowsHostOp,
    args: string[]
  ): Promise<boolean> => {
    const command = helixdWindowsNodeCommandLine(
      helixdWindowsPinnedNodePath(target.host, baseDir),
      [script, op, ...args]
    )
    const answer = await execCommand(target.conn, command, {
      wrapCommand: false,
      signal: target.signal
    }).catch((error: unknown) => {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
      return ''
    })
    return answer.trim().split(/\r?\n/u).at(-1) === HELIXD_WINDOWS_HOST_SCRIPT_PRESENT
  }
  if (!(await runOp(scriptPath, 'script-present', []))) {
    const partial = `${scriptPath}.${randomUUID()}.partial`
    await target.conn.writeFile(partial, HELIXD_WINDOWS_HOST_SCRIPT, {
      hostPlatform: target.host,
      signal: target.signal
    })
    if (!(await runOp(partial, 'script-install', [scriptPath]))) {
      throw new Error(`Could not stage the helixd host script at ${scriptPath}.`)
    }
  }
  staged.add(scriptPath)
}

export function readHelixdWindowsEncodedAnswer(output: string, marker: string): string | null {
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .findLast((candidate) => candidate === marker || candidate.startsWith(`${marker} `))
  if (line === undefined) {
    return null
  }
  const encoded = line.slice(marker.length).trim()
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
    return null
  }
  return Buffer.from(encoded, 'base64').toString('utf8')
}
