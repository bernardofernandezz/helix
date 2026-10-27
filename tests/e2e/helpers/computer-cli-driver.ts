import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createElectronHomeIsolation } from './electron-home-isolation'

const execFileAsync = promisify(execFile)
const RUNTIME_METADATA_FILE = 'helix-runtime.json'
let helixDevUserDataPath: string | null = null
let helixServeProcess: ChildProcess | null = null
let helixServeStdout = ''
let helixServeStderr = ''

export type CliResult = {
  stdout: string
  stderr: string
}

type RunHelixCliOptions = {
  retryMissingRuntimeMetadata?: boolean
}

export async function runHelixCli(
  args: string[],
  options: RunHelixCliOptions = {}
): Promise<CliResult> {
  try {
    return await runHelixCliOnce(args)
  } catch (error) {
    if (
      options.retryMissingRuntimeMetadata !== false &&
      isMissingRuntimeMetadataError(args, error)
    ) {
      // Windows can lose the dev runtime while launching the fixture app; reopen once before the desktop action.
      await ensureHelixRuntimeLaunched()
      return await runHelixCliOnce(args)
    }
    throw error
  }
}

async function runHelixCliOnce(args: string[]): Promise<CliResult> {
  const devCli = join(process.cwd(), 'config/scripts/helix-dev.mjs')
  const command = process.env.HELIX_COMPUTER_CLI ?? process.execPath
  const cliArgs = process.env.HELIX_COMPUTER_CLI ? args : [devCli, ...args]
  const env = process.env.HELIX_COMPUTER_CLI
    ? { ...process.env }
    : await createComputerE2ERuntimeEnv()
  try {
    const result = await execFileAsync(command, cliArgs, {
      env,
      maxBuffer: 20 * 1024 * 1024
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const output = error as { message: string; stdout: string; stderr: string }
      throw new Error(`${output.message}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`)
    }
    throw error
  }
}

export async function ensureHelixRuntimeLaunched(): Promise<void> {
  if (!process.env.HELIX_COMPUTER_CLI && process.platform === 'win32') {
    await ensureHelixRuntimeServed()
    return
  }
  await runHelixCli(['open', '--json'], { retryMissingRuntimeMetadata: false })
  await waitForHelixRuntimeReady()
}

export async function stopHelixRuntime(): Promise<void> {
  const processToStop = helixServeProcess
  if (!processToStop?.pid) {
    return
  }
  helixServeProcess = null
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'])
    } catch {
      // The foreground test runtime may already have exited.
    }
    return
  }
  processToStop.kill()
}

export function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

async function getComputerE2eHelixDevUserDataPath(): Promise<string> {
  if (!helixDevUserDataPath) {
    // Use a fresh profile so a retained dev runtime cannot execute stale provider code.
    helixDevUserDataPath = await mkdtemp(join(tmpdir(), 'helix-computer-runtime-'))
  }
  return helixDevUserDataPath
}

async function waitForHelixRuntimeReady(): Promise<void> {
  const userDataPath = await getComputerE2eHelixDevUserDataPath()
  const metadataPath = join(userDataPath, RUNTIME_METADATA_FILE)
  const deadline = Date.now() + 15000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      await access(metadataPath)
      const status = parseJsonOutput<{
        result: { runtime: { reachable: boolean } }
      }>((await runHelixCli(['status', '--json'], { retryMissingRuntimeMetadata: false })).stdout)
      if (status.result.runtime.reachable) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }

  const detail = [
    lastError instanceof Error ? `Last error: ${lastError.message}` : null,
    helixServeStdout.trim() ? `serve stdout: ${helixServeStdout.trim()}` : null,
    helixServeStderr.trim() ? `serve stderr: ${helixServeStderr.trim()}` : null
  ]
    .filter(Boolean)
    .join(' ')
  throw new Error(`Helix runtime metadata was not ready at ${metadataPath}.${detail}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureHelixRuntimeServed(): Promise<void> {
  if (!helixServeProcess || helixServeProcess.exitCode !== null) {
    const devCli = join(process.cwd(), 'config/scripts/helix-dev.mjs')
    const env = await createComputerE2ERuntimeEnv()
    helixServeStdout = ''
    helixServeStderr = ''
    helixServeProcess = spawn(process.execPath, [devCli, 'serve', '--no-pairing', '--json'], {
      env,
      windowsHide: true
    })
    helixServeProcess.stdout?.on('data', (chunk) => {
      helixServeStdout += String(chunk)
    })
    helixServeProcess.stderr?.on('data', (chunk) => {
      helixServeStderr += String(chunk)
    })
    helixServeProcess.once('exit', () => {
      helixServeProcess = null
    })
    process.once('exit', () => {
      helixServeProcess?.kill()
    })
  }
  await waitForHelixRuntimeReady()
}

async function createComputerE2ERuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  const userDataDir =
    process.env.HELIX_DEV_USER_DATA_PATH ?? (await getComputerE2eHelixDevUserDataPath())
  // Strip ELECTRON_RUN_AS_NODE or the Electron child runs as plain Node.
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnv } = process.env
  void _electronRunAsNode
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  return {
    ...isolation.env,
    // Keep CLI and Electron on the same runtime metadata while fixture HOME/Codex isolation remains in force.
    HELIX_DEV_USER_DATA_PATH: userDataDir
  }
}

function isMissingRuntimeMetadataError(args: string[], error: unknown): boolean {
  if (args[0] !== 'computer') {
    return false
  }
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false
  }
  const message = String((error as { message?: unknown }).message)
  return (
    message.includes('"code": "runtime_unavailable"') &&
    message.includes('Could not read Helix runtime metadata')
  )
}
