import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { constants } from 'node:os'
import { spawnProcess } from '@helix/process-host'
import { resolveHelixdInstallRoot } from './helixd-app-paths'
import { HELIXD_EXIT_CONFIGURATION } from './helixd-configuration-exit'
import {
  HELIXD_NODE_RUNTIME_MARKER_FILENAME,
  HELIXD_SERVER_TARGET_FILENAME,
  HELIXD_VERSION_FILENAME,
  helixdNodeRuntimeRelativePath
} from '../../shared/helixd-artifacts'
import { NODE_RUNTIME_PIN, nodeRuntimeAsset } from '../../shared/node-runtime-pin'

export class HelixdBundledRuntimeError extends Error {}
export const HELIXD_BUNDLED_LAUNCHER_ENV = 'HELIX_BUNDLED_LAUNCHER_CHANNEL'

/** Null for unpackaged entries; reject torn/foreign runtime references in packaged slots. */
export function resolveBundledHelixdRuntime(directory: string): string | null {
  const markerPath = join(directory, HELIXD_NODE_RUNTIME_MARKER_FILENAME)
  const targetPath = join(directory, HELIXD_SERVER_TARGET_FILENAME)
  const hasMarker = existsSync(markerPath)
  const hasTarget = existsSync(targetPath)
  if (!hasMarker && !hasTarget && !existsSync(join(directory, HELIXD_VERSION_FILENAME))) {
    return null
  }
  if (!hasTarget) {
    throw new HelixdBundledRuntimeError('The bundled Helix runtime target is missing')
  }
  if (!hasMarker) {
    throw new HelixdBundledRuntimeError('The bundled Helix runtime reference is missing')
  }
  const target = readFileSync(targetPath, 'utf8').trim()
  // Compat targets use the same Node version built for older glibc.
  const asset = nodeRuntimeAsset(target)
  if (!asset) {
    throw new HelixdBundledRuntimeError(`The bundled Helix runtime target is invalid: ${target}`)
  }
  const executableSha256 = readFileSync(markerPath, 'utf8').trim()
  // Validate the exact runtime pin: this marker becomes a path segment.
  if (executableSha256 !== asset.executableSha256) {
    throw new HelixdBundledRuntimeError(
      `The bundled Helix runtime reference does not name Node ${NODE_RUNTIME_PIN.version}`
    )
  }
  const runtime = join(directory, ...helixdNodeRuntimeRelativePath(target, executableSha256))
  if (!existsSync(runtime)) {
    throw new HelixdBundledRuntimeError('The bundled Helix runtime is missing')
  }
  return runtime
}

export function resolveBundledHelixdSlot(script = process.argv[1]): string {
  return resolveHelixdInstallRoot(script && realpathSync(script))
}

export function isRunningAsBundledHelixdRuntime(directory: string): boolean {
  const runtime = resolveBundledHelixdRuntime(directory)
  return runtime !== null && realpathSync(process.execPath) === realpathSync(runtime)
}

/** Reject substituted runtimes before opening profile state. */
export function assertHelixdServerRuntime(): void {
  if (Number(process.versions.node.split('.')[0]) < 18) {
    throw new HelixdBundledRuntimeError('The Helix server requires Node.js 18 or newer')
  }
  const directory = resolveBundledHelixdSlot()
  const runtime = resolveBundledHelixdRuntime(directory)
  if (runtime && !isRunningAsBundledHelixdRuntime(directory)) {
    throw new HelixdBundledRuntimeError('Start the Helix server with its bundled Node.js runtime')
  }
  if (runtime && process.versions.node !== NODE_RUNTIME_PIN.version) {
    throw new HelixdBundledRuntimeError(
      `The bundled Helix runtime must be Node ${NODE_RUNTIME_PIN.version}`
    )
  }
}

/** Hand old service commands to pinned Node before they can open profile state. */
export function handoffToBundledHelixd(): boolean {
  const script = process.argv[1]
  if (!script) {
    return false
  }
  const entry = realpathSync(script)
  const runtime = resolveBundledHelixdRuntime(dirname(entry))
  if (!runtime) {
    return false
  }
  if (realpathSync(process.execPath) === realpathSync(runtime)) {
    if (process.versions.node !== NODE_RUNTIME_PIN.version) {
      throw new HelixdBundledRuntimeError(
        `The bundled Helix runtime must be Node ${NODE_RUNTIME_PIN.version}`
      )
    }
    return false
  }
  const child = spawnProcess({
    program: runtime,
    args: [entry, ...process.argv.slice(2)],
    env: { ...process.env, [HELIXD_BUNDLED_LAUNCHER_ENV]: '1' },
    // Detach so Windows child jobs cannot kill the runtime before launcher-disconnect cleanup.
    detached: true,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  })
  // Node resets nohup; stop through INT/TERM or owner loss instead.
  const ignoreHangup = (): void => {}
  if (process.platform !== 'win32') {
    process.on('SIGHUP', ignoreHangup)
  }
  const forwards = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    const forward = (): void => {
      if (process.platform === 'win32') {
        // Detached Windows children have their own console; disconnect allows durable shutdown.
        if (child.connected) {
          child.disconnect()
        }
      } else {
        child.kill(signal)
      }
    }
    process.on(signal, forward)
    return { signal, forward }
  })
  const cleanup = (): void => {
    process.off('SIGHUP', ignoreHangup)
    for (const { signal, forward } of forwards) {
      process.off(signal, forward)
    }
  }
  child.once('error', (error) => {
    cleanup()
    console.error('helixd: could not start the bundled runtime:', error.message)
    process.exit(HELIXD_EXIT_CONFIGURATION)
  })
  child.once('exit', (code, signal) => {
    cleanup()
    if (signal && process.platform !== 'win32') {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1))
  })
  return true
}
