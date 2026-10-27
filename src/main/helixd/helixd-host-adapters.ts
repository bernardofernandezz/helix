import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { HELIXD_CLI_PACKAGE_FILENAME } from '../../shared/helixd-artifacts'
import { setAppEnvironment, type AppEnvironment } from '../../shared/app-environment'
import { setSecretStore } from '../../shared/secret-store'
import { resolveHelixdInstallRoot, resolveHelixdPath } from './helixd-app-paths'
import { getHelixdCliLauncherPath } from './helixd-cli-launcher'
import { createHelixdSecretStore, type HelixdSecretStore } from './helixd-secret-store'
import { setSpeechServiceFactories } from '../speech/speech-runtime-service'
import { helixdSpeechServiceFactories } from './helixd-speech-services'

let quitRegisteredHandlers = (): void => {}

export function runHelixdQuitHandlers(): void {
  quitRegisteredHandlers()
}

function createNodeAppEnvironment(): AppEnvironment {
  const quitHandlers: (() => void)[] = []
  // Synchronous quit handlers must not preempt the signal handler’s awaited runtime/browser teardown.
  quitRegisteredHandlers = (): void => {
    const errors: unknown[] = []
    for (const handler of quitHandlers.splice(0)) {
      try {
        handler()
      } catch (error) {
        errors.push(error)
      }
    }
    // Failed handlers may leave writers running and keep the instance lock held.
    if (errors.length > 0) {
      throw new AggregateError(errors, 'helixd_quit_handlers_failed')
    }
  }
  return {
    getPath: resolveHelixdPath,
    getAppPath: () => resolveHelixdInstallRoot(),
    getVersion: () => process.env.HELIX_VERSION ?? '0.0.0-helixd',
    // Packaged gates production HTTPS/CLI/PATH policy; layout callers must inspect asar separately.
    isPackaged: () => true,
    getCliLauncherPath: getHelixdCliLauncherPath,
    onWillQuit: (handler) => quitHandlers.push(handler),
    exit: (code = 0) => process.exit(code),
    getAppMetrics: () => []
  }
}

let helixdSecretStore: HelixdSecretStore | null = null

export async function prepareHelixdSecretStore(
  keyDir: string,
  userDataPath: string
): Promise<boolean> {
  if (!helixdSecretStore) {
    throw new Error('helixd_secret_store_not_installed — call installHelixdHostAdapters() first')
  }
  return helixdSecretStore.prepare({ keyDir, userDataPath })
}

/** Stamp the bundle’s own release so inherited desktop versions cannot misidentify this server. */
export function stampHelixdAppVersion(installRoot: () => string = resolveHelixdInstallRoot): void {
  let version: unknown
  try {
    const path = join(installRoot(), ...HELIXD_CLI_PACKAGE_FILENAME.split('/'))
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    version = parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : null
  } catch {
    return
  }
  if (typeof version === 'string' && version.length > 0) {
    process.env.HELIX_APP_VERSION = version
  }
}

export function installHelixdHostAdapters(): void {
  stampHelixdAppVersion()
  setAppEnvironment(createNodeAppEnvironment())
  helixdSecretStore = createHelixdSecretStore()
  setSecretStore(helixdSecretStore)
  setSpeechServiceFactories(helixdSpeechServiceFactories)
}
