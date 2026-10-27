import { getAppEnvironment } from '../../shared/app-environment'
import type { RuntimeRpcClientActivity } from '../runtime/runtime-rpc/runtime-rpc-shutdown'
import type { HelixdIdleExitEvidence } from './helixd-idle-exit-monitor'
import {
  activationFenceExists,
  createHelixdIdleProbes,
  installHelixdManagedIdleExit,
  resolveHelixdManagedIdleExit,
  type HelixdManagedIdleExitConfig,
  type HelixdManagedIdleExitPorts
} from './helixd-managed-idle-exit'
import type { HelixdDaemonRetirement } from './helixd-daemon-retirement'
import { recoverDaemonAfterCancelledIdleStop } from './helixd-idle-stop-daemon-recovery'
import {
  consumeHelixdIdleStopRecord,
  discardHelixdIdleStopRecord,
  writeHelixdIdleStopRecord
} from './helixd-idle-stop-record'
import type { HelixdShutdownTrigger } from './helixd-lifecycle'
import type { HelixdIdleStopRecord } from '../../shared/helixd-idle-exit'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'

let requestIdleShutdown: HelixdShutdownTrigger | null = null

/** Signal handling binds later; the quiet period must outlast the startup gap. */
export function bindHelixdIdleShutdown(request: HelixdShutdownTrigger): void {
  requestIdleShutdown = request
}

type HelixdIdleExitRuntimePorts = {
  rpc: { readClientActivity(): RuntimeRpcClientActivity }
  agentStates: () => readonly { state: string }[]
  hasStagedMigration: () => boolean
  automationsBusy: () => boolean
  /** Stop the monitor before recording signal-driven shutdown. */
  registerCleanup: (cleanup: () => void) => void
}

/** Under the startup lock, consume previous idle-stop evidence before this run can overwrite it. */
export function beginHelixdIdleExit(userDataPath: string): {
  previousIdleStop: HelixdIdleStopRecord | null | undefined
  start: (ports: HelixdIdleExitRuntimePorts) => Promise<void>
} {
  const config = resolveHelixdManagedIdleExit(process.env)
  if (!config) {
    return { previousIdleStop: undefined, start: async () => {} }
  }
  const previousIdleStop = consumeHelixdIdleStopRecord(userDataPath)
  if (previousIdleStop) {
    console.error(`[helixd] the previous run stopped idle at ${previousIdleStop.stoppedAt}`)
  }
  const version = getAppEnvironment().getVersion()
  return {
    previousIdleStop,
    start: (ports) => startHelixdManagedIdleExit({ ...ports, config, userDataPath, version })
  }
}

async function startHelixdManagedIdleExit(
  input: HelixdIdleExitRuntimePorts & {
    config: HelixdManagedIdleExitConfig
    userDataPath: string
    version: string
  }
): Promise<void> {
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { getCurrentDaemonPid, getDaemonEndpointFacts, isDaemonTerminalAdmissionClosed } =
    await import('../daemon/daemon-provider-state')
  const { countLiveHelixdDaemonSessions, retireHelixdDaemonIfIdle } =
    await import('./helixd-daemon-retirement')
  const idleRecord = createIdleStopRecordOwnership(input.userDataPath)
  const hasChatProviders = (): boolean =>
    getStructuredAgentSessionHost()?.hasLoadedProviders() ?? false
  const ports: HelixdManagedIdleExitPorts = {
    readClientActivity: () => input.rpc.readClientActivity(),
    listTerminals: () => getLocalPtyProvider().listProcesses(),
    countDaemonSessions: countLiveHelixdDaemonSessions,
    hasDaemon: () => getDaemonEndpointFacts() !== null,
    agentStates: input.agentStates,
    hasChatProviders,
    hasStagedMigration: input.hasStagedMigration,
    automationsBusy: input.automationsBusy,
    activationFenceExists
  }
  // Client/terminal evidence is already checked; recheck other work exit would destroy.
  const nonTerminalWorkProbes = createHelixdIdleProbes(input.config, ports).filter(
    (probe) => probe.name !== 'clients' && probe.name !== 'terminals'
  )
  const hasNonTerminalWork = async (): Promise<boolean> => {
    for (const probe of nonTerminalWorkProbes) {
      if (
        (await Promise.resolve()
          .then(probe.read)
          .catch(() => 'unverifiable')) !== 'idle'
      ) {
        return true
      }
    }
    return false
  }
  const dispose = installHelixdManagedIdleExit({
    config: input.config,
    ports,
    stop: async (evidence) => {
      // Replacement must target only the daemon incarnation that agreed to retire.
      const retiringPid = getCurrentDaemonPid()
      const outcome = await stopForIdle(input, evidence, retireHelixdDaemonIfIdle)
      // Clients/providers can return while the retirement reply is pending.
      const activity = input.rpc.readClientActivity()
      if (
        hasChatProviders() ||
        activity.openConnections > 0 ||
        activity.requestsInFlight > 0 ||
        activity.lastRequestAt > evidence.quietSince
      ) {
        discardHelixdIdleStopRecord(input.userDataPath)
        const daemon = await recoverDaemonAfterCancelledIdleStop(outcome, {
          admissionClosed: isDaemonTerminalAdmissionClosed,
          retireAgain: () => retireHelixdDaemonIfIdle(),
          replaceDaemon: async () => {
            if (retiringPid === null) {
              throw new Error('the retiring daemon never identified itself')
            }
            const { restartDaemon } = await import('../daemon/daemon-provider-restart')
            await restartDaemon({ expectedDaemonPid: retiringPid, endpointMayBeGone: true })
          }
        })
        if (daemon === 'serving' || (await hasNonTerminalWork())) {
          return false
        }
        idleRecord.requestShutdown(requestIdleShutdown)
        return true
      }
      idleRecord.requestShutdown(requestIdleShutdown)
      return true
    }
  })
  input.registerCleanup(() => {
    dispose()
    idleRecord.onShutdown()
  })
}

/** Discard failed, overdue and externally superseded idle stops, including cleanup before request completion. */
export function createIdleStopRecordOwnership(userDataPath: string): {
  requestShutdown(request: HelixdShutdownTrigger | null): void
  onShutdown(): void
} {
  let idleOwnsStop = false
  const discard = (): void => discardHelixdIdleStopRecord(userDataPath)
  return {
    requestShutdown: (request) => {
      // Cleanup may run before the trigger returns, so establish ownership first.
      idleOwnsStop = true
      if (request?.('idle', discard) !== true) {
        idleOwnsStop = false
        discard()
      }
    },
    onShutdown: () => {
      if (!idleOwnsStop) {
        discard()
      }
    }
  }
}

async function stopForIdle(
  input: { userDataPath: string; version: string },
  evidence: HelixdIdleExitEvidence,
  retireDaemon: () => Promise<HelixdDaemonRetirement>
): Promise<HelixdDaemonRetirement> {
  console.error(`[helixd] stopping: no client, terminal or job for ${evidence.timeoutMs}ms`)
  try {
    writeHelixdIdleStopRecord(input.userDataPath, evidence, input.version)
  } catch (error) {
    console.error('[helixd] could not record the idle stop:', error)
  }
  // Only the daemon’s atomic empty census can authorize retirement.
  const outcome = await retireDaemon().catch((error: unknown): HelixdDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: String(error)
  }))
  console.error(
    `[helixd] terminal daemon on idle stop: ${outcome.retirement}${outcome.reason ? ` (${outcome.reason})` : ''}`
  )
  return outcome
}
