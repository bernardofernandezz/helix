// Live terminals block idle exit; ordinary shutdown disconnects without killing their daemon.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { RELAY_INSTALL_LOCK_NAME } from '../../shared/relay-install-lock-name'
import { hasErrorCode } from '../daemon/daemon-process-inspection'
import type { RuntimeRpcClientActivity } from '../runtime/runtime-rpc/runtime-rpc-shutdown'
import { HELIXD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/helixd-managed-launch-env'
import {
  HELIXD_IDLE_EXIT_TIMEOUT_MS,
  readHelixdE2EIdleTimeoutMs
} from '../../shared/helixd-idle-exit'
import {
  HelixdIdleExitMonitor,
  type HelixdIdleExitEvidence,
  type HelixdIdleProbe,
  type HelixdIdleVerdict
} from './helixd-idle-exit-monitor'

export type HelixdManagedIdleExitConfig = { timeoutMs: number; activationRoot: string }

/** User-started/paired servers never idle out; only client-managed launches opt in. */
export function resolveHelixdManagedIdleExit(
  env: NodeJS.ProcessEnv
): HelixdManagedIdleExitConfig | null {
  const activationRoot = env[HELIXD_MANAGED_ACTIVATION_ROOT_ENV]
  if (!activationRoot) {
    return null
  }
  return {
    timeoutMs: readHelixdE2EIdleTimeoutMs(env) ?? HELIXD_IDLE_EXIT_TIMEOUT_MS,
    activationRoot
  }
}

export type HelixdManagedIdleExitPorts = {
  readClientActivity: () => RuntimeRpcClientActivity
  listTerminals: () => Promise<readonly unknown[]>
  /** Null means some daemon generation did not answer. */
  countDaemonSessions: () => Promise<number | null>
  hasDaemon: () => boolean
  agentStates: () => readonly { state: string }[]
  hasChatProviders: () => boolean
  hasStagedMigration: () => boolean
  /** Enabled schedules or unsettled runs would be lost on exit. */
  automationsBusy: () => boolean
  activationFenceExists: (root: string) => Promise<boolean>
}

export function createHelixdIdleProbes(
  config: HelixdManagedIdleExitConfig,
  ports: HelixdManagedIdleExitPorts
): HelixdIdleProbe[] {
  const verdict = (busy: boolean): HelixdIdleVerdict => (busy ? 'busy' : 'idle')
  return [
    {
      name: 'clients',
      read: () => {
        const activity = ports.readClientActivity()
        return verdict(activity.openConnections > 0 || activity.requestsInFlight > 0)
      }
    },
    {
      name: 'terminals',
      read: async () => {
        if ((await ports.listTerminals()).length > 0) {
          return 'busy'
        }
        // Daemons may retain sessions absent from this process’s provider inventory.
        if (!ports.hasDaemon()) {
          return 'idle'
        }
        const live = await ports.countDaemonSessions()
        return live === null ? 'unverifiable' : verdict(live > 0)
      }
    },
    {
      name: 'agents',
      read: () => verdict(ports.agentStates().some((entry) => entry.state === 'working'))
    },
    { name: 'chat-providers', read: () => verdict(ports.hasChatProviders()) },
    { name: 'migration', read: () => verdict(ports.hasStagedMigration()) },
    { name: 'automations', read: () => verdict(ports.automationsBusy()) },
    {
      name: 'activation',
      read: async () => verdict(await ports.activationFenceExists(config.activationRoot))
    }
  ]
}

/** A bare activation root may be interrupted acquisition; only its lock proves a held fence. */
export async function activationFenceExists(root: string): Promise<boolean> {
  try {
    await stat(join(root, RELAY_INSTALL_LOCK_NAME))
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

export function installHelixdManagedIdleExit(input: {
  config: HelixdManagedIdleExitConfig
  ports: HelixdManagedIdleExitPorts
  stop: (evidence: HelixdIdleExitEvidence) => void | boolean | Promise<void | boolean>
}): () => void {
  const monitor = new HelixdIdleExitMonitor({
    timeoutMs: input.config.timeoutMs,
    probes: createHelixdIdleProbes(input.config, input.ports),
    lastClientActivityAt: () => input.ports.readClientActivity().lastRequestAt,
    onIdle: input.stop
  })
  monitor.start()
  return () => monitor.stop()
}
