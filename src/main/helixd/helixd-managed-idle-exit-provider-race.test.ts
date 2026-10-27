import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HELIXD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/helixd-managed-launch-env'
import { bindHelixdIdleShutdown, beginHelixdIdleExit } from './helixd-managed-idle-exit-host'
import { installHelixdManagedIdleExit } from './helixd-managed-idle-exit'
import type * as ManagedIdleExit from './helixd-managed-idle-exit'
import type * as DaemonProviderState from '../daemon/daemon-provider-state'
import { retireHelixdDaemonIfIdle } from './helixd-daemon-retirement'
import { discardHelixdIdleStopRecord } from './helixd-idle-stop-record'
import { restartDaemon } from '../daemon/daemon-provider-restart'

const { hasLoadedProviders } = vi.hoisted(() => ({ hasLoadedProviders: vi.fn(() => false) }))

vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => ({ hasLoadedProviders })
}))
vi.mock('../ipc/pty/provider/registry', () => ({
  getLocalPtyProvider: () => ({ listProcesses: async () => [] })
}))
vi.mock('../daemon/daemon-init', () => ({ getDaemonEndpointFacts: () => null }))
vi.mock('./helixd-daemon-retirement', () => ({
  countLiveHelixdDaemonSessions: vi.fn(async () => 0),
  retireHelixdDaemonIfIdle: vi.fn()
}))
vi.mock('../daemon/daemon-provider-state', async (importOriginal) => ({
  ...(await importOriginal<typeof DaemonProviderState>()),
  getCurrentDaemonPid: () => 4242
}))
vi.mock('../daemon/daemon-provider-restart', () => ({ restartDaemon: vi.fn(async () => ({})) }))
vi.mock('./helixd-idle-stop-record', () => ({
  consumeHelixdIdleStopRecord: vi.fn(() => null),
  discardHelixdIdleStopRecord: vi.fn(),
  writeHelixdIdleStopRecord: vi.fn()
}))
vi.mock('./helixd-managed-idle-exit', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedIdleExit>()),
  installHelixdManagedIdleExit: vi.fn(() => () => {})
}))

beforeEach(() => {
  vi.clearAllMocks()
  hasLoadedProviders.mockReturnValue(false)
  vi.stubEnv(HELIXD_MANAGED_ACTIVATION_ROOT_ENV, 'test-fence')
})

afterEach(() => vi.unstubAllEnvs())

it.each(['provider', 'client', 'request', 'recent request'])(
  'rechecks a returning %s after daemon retirement before requesting an idle shutdown',
  async (returning) => {
    const activity = { openConnections: 0, requestsInFlight: 0, lastRequestAt: 0 }
    const retire = Promise.withResolvers<{ retirement: string; reason: null }>()
    vi.mocked(retireHelixdDaemonIfIdle).mockImplementationOnce(async () => ({
      ...(await retire.promise),
      retirement: 'retired',
      liveSessions: 0
    }))
    const shutdown = vi.fn(() => true)
    bindHelixdIdleShutdown(shutdown)
    await beginHelixdIdleExit('test-profile').start({
      rpc: {
        readClientActivity: () => activity
      },
      agentStates: () => [],
      hasStagedMigration: () => false,
      automationsBusy: () => false,
      registerCleanup: () => {}
    })
    const installed = vi.mocked(installHelixdManagedIdleExit).mock.calls.at(-1)?.[0]
    if (!installed) {
      throw new Error('idle monitor was not installed')
    }
    const stopping = installed.stop({ quietSince: 0, stoppedAt: 900_000, timeoutMs: 900_000 })
    hasLoadedProviders.mockReturnValue(returning === 'provider')
    activity.openConnections = returning === 'client' ? 1 : 0
    activity.requestsInFlight = returning === 'request' ? 1 : 0
    activity.lastRequestAt = returning === 'recent request' ? 1 : 0
    retire.resolve({ retirement: 'retired', reason: null })

    expect(await stopping).toBe(false)
    expect(shutdown).not.toHaveBeenCalled()
    expect(discardHelixdIdleStopRecord).toHaveBeenCalledWith('test-profile')
    expect(restartDaemon).toHaveBeenCalledOnce()
  }
)
