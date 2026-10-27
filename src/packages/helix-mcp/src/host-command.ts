import { runProcess } from '@helix/process-host'
import { open, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const COMMAND_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export type CommandRunner = (
  file: string,
  args: string[],
  options?: { timeoutMs?: number }
) => Promise<string>

export const runCommand: CommandRunner = async (file, args, options = {}) => {
  const result = await runProcess({
    program: file,
    args,
    timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES
  })
  if (result.code !== 0) {
    const detail =
      result.stderr.trim() || (result.timedOut ? 'timed out' : `exited with code ${result.code}`)
    throw new Error(`${file} failed: ${detail.slice(0, 2_000)}`)
  }
  return result.stdout
}

// Host aliases come from ~/.ssh/config or user@host; a leading "-" would be read as an ssh option.
export const SSH_HOST_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._@:-]*$/

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function sshArgs(host: string, remoteCommand: string): string[] {
  if (!SSH_HOST_PATTERN.test(host)) {
    throw new Error(`invalid SSH host: ${host}`)
  }
  // BatchMode never prompts: agents cannot answer password or host-key questions.
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, remoteCommand]
}

export function runOnHost(
  runner: CommandRunner,
  host: string,
  remoteCommand: string
): Promise<string> {
  return runner('ssh', sshArgs(host, remoteCommand))
}

/** Reads the last `maxBytes` of a text file on this machine or, with `host`, over SSH. */
export async function readFileTail(
  runner: CommandRunner,
  path: string,
  maxBytes: number,
  host?: string
): Promise<string> {
  if (host) {
    return runOnHost(runner, host, `tail -c ${maxBytes} -- ${shellQuote(path)}`)
  }
  const absolute = resolve(path)
  const { size } = await stat(absolute)
  const length = Math.min(size, maxBytes)
  const handle = await open(absolute, 'r')
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Newest file in `dir` whose name ends with `suffix`, by modification time. */
export async function newestFile(
  runner: CommandRunner,
  dir: string,
  suffix: string,
  host?: string
): Promise<string | null> {
  if (host) {
    const out = await runOnHost(
      runner,
      host,
      `ls -1t -- ${shellQuote(dir)} 2>/dev/null | grep -F -- ${shellQuote(suffix)} | head -n 1`
    ).catch(() => '')
    const name = out.trim()
    return name ? `${dir.replace(/\/+$/, '')}/${name}` : null
  }
  const absolute = resolve(dir)
  const names = await readdir(absolute).catch(() => [])
  let newest: { path: string; mtime: number } | null = null
  for (const name of names) {
    if (!name.endsWith(suffix)) {
      continue
    }
    const path = join(absolute, name)
    const { mtimeMs } = await stat(path)
    if (!newest || mtimeMs > newest.mtime) {
      newest = { path, mtime: mtimeMs }
    }
  }
  return newest?.path ?? null
}
