import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflightProfileStateRuntime } from '../persistence/profile-state/profile-state-runtime-preflight'
import {
  HELIXD_STARTUP_PREFLIGHT_FLAG,
  HELIXD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseHelixdProfilePreflight,
  helixdProfilePreflightResponseSchema,
  type HelixdProfilePreflightResponse
} from '../../shared/helixd-profile-preflight'
import { readHelixdArtifactIdentity } from './helixd-artifact-identity'
import { HELIXD_EXIT_CONFIGURATION } from './helixd-configuration-exit'
import {
  HELIXD_SERVER_ENTRY_FILENAME,
  HELIXD_VERSION_FILENAME
} from '../../shared/helixd-artifacts'
import { HELIXD_NODE_RUNTIME_IDENTITY } from '../../shared/helixd-node-runtime-identity'
import { runProcess } from '@helix/process-host'
import { preflightHelixdNativeRuntime } from './helixd-runtime-native-preflight'
import { helixdCompileCacheEnv } from './helixd-compile-cache'
import {
  isRunningAsBundledHelixdRuntime,
  HelixdBundledRuntimeError,
  resolveBundledHelixdSlot
} from './helixd-bundled-runtime'

/** Qualify packaged startup before touching profile indexes, data-root locks or imports. */
export async function preflightBundledHelixdStartup(): Promise<void> {
  const directory = resolveBundledHelixdSlot()
  if (!isRunningAsBundledHelixdRuntime(directory)) {
    return
  }
  const identity = await readInstalledVersion(directory)
  const nonce = randomUUID()
  // Keep disposable SQLite ownership and native state out of the serving process.
  const result = await runProcess({
    program: process.execPath,
    args: [join(directory, HELIXD_SERVER_ENTRY_FILENAME), HELIXD_STARTUP_PREFLIGHT_FLAG, nonce],
    // Reuse the serving runtime code cache for this identical bundle.
    env: { ...process.env, HELIX_BACKGROUND_LAUNCH: '1', ...helixdCompileCacheEnv(directory) },
    timeoutMs: HELIXD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    maxOutputBytes: 64 * 1024,
    terminationBarrier: true
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    const Failure = result.code === HELIXD_EXIT_CONFIGURATION ? HelixdBundledRuntimeError : Error
    throw new Failure(`The bundled Helix runtime failed readiness: ${result.stderr}`)
  }
  try {
    parseHelixdProfilePreflight(result.stdout, nonce, HELIXD_NODE_RUNTIME_IDENTITY, identity)
  } catch (cause) {
    throw new HelixdBundledRuntimeError('The bundled runtime returned invalid readiness identity', {
      cause
    })
  }
}

export async function runHelixdProfilePreflight(
  nonce: string | undefined,
  options: { nativeFeatures?: boolean } = {}
): Promise<void> {
  const checkedNonce = z.string().uuid().parse(nonce)
  const directory = resolveBundledHelixdSlot()
  let artifactVersion: string
  try {
    artifactVersion = await readHelixdArtifactIdentity(directory)
  } catch (cause) {
    throw new HelixdBundledRuntimeError('The bundled Helix artifacts are incomplete or altered', {
      cause
    })
  }
  const result = await preflightProfileStateRuntime()
  // Host Node rollback launchers do not serve the bundled slot.
  if (isRunningAsBundledHelixdRuntime(directory)) {
    await preflightHelixdNativeRuntime(options)
  }
  const response: HelixdProfilePreflightResponse = {
    type: 'helix_profile_state_ready',
    nonce: checkedNonce,
    runtime: 'node',
    runtimeVersion: process.versions.node,
    artifactVersion,
    ...result
  }
  console.log(JSON.stringify(response))
}

async function readInstalledVersion(directory: string): Promise<string> {
  try {
    return helixdProfilePreflightResponseSchema.shape.artifactVersion.parse(
      (await readFile(join(directory, HELIXD_VERSION_FILENAME), 'utf8')).trim()
    )
  } catch (cause) {
    throw new HelixdBundledRuntimeError(
      'The installed Helix artifact version is missing or invalid',
      {
        cause
      }
    )
  }
}
