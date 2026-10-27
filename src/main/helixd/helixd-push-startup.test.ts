import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProfilePreferences } from '../persistence/loading-store/profile-preferences'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { DeviceRegistry } from '../runtime/device-registry'
import { RuntimeMobileNotificationController } from '../runtime/runtime-mobile-notification-controller'
import { PushUnregisterOutbox } from '../runtime/push/push-unregister-outbox'
import { createPushHostKeypair } from '../runtime/push/push-host-challenge-fixtures'
import { acquireProfileStateMaintenance } from '../persistence/profile-state/profile-state-access'
import { profileStateAccessPaths } from '../persistence/profile-state/profile-state-access-owner'

const state = vi.hoisted(() => ({
  root: '',
  controller: null as RuntimeMobileNotificationController | null,
  registry: null as DeviceRegistry | null,
  rpcStarted: false,
  profileStartupErrors: new Array<Error>(),
  onSettingsChanged: vi.fn<ProfilePreferences['onSettingsChanged']>(),
  removeSettingsListener: vi.fn(),
  startDaemon: vi.fn(async () => {}),
  browserProvider: vi.fn(async () => null),
  register: vi.fn(async () => ({ ok: true, registrationId: 'headless-registration' })),
  send: vi.fn(async () => ({ ok: true, results: [] })),
  startCodexHooks: vi.fn(),
  installManagedAgentHooks: vi.fn(async () => []),
  refreshOpenCodePlugins: vi.fn(),
  adoptLoginShellAgentHomes: vi.fn(async () => {})
}))
const profile = vi.hoisted(() => {
  const value: { settings: Partial<GlobalSettings> } = { settings: {} }
  return value
})
// Reconciliation writes user-global agent configs; isolate it from the real home.
vi.mock('../codex/codex-hook-reconcile', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startCodexHooks: state.startCodexHooks
}))
vi.mock('../agent-hooks/managed-agent-hook-controls', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installManagedAgentHooks: state.installManagedAgentHooks
}))
vi.mock('../agent-hooks/local-agent-cli-presence', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hydrateAgentCliShellPath: async () => {}
}))
vi.mock('../agent-hooks/agent-home-login-shell', () => ({
  adoptLoginShellAgentHomes: state.adoptLoginShellAgentHomes
}))
vi.mock('../claude/agent-view-service', () => ({
  getClaudeAgentViewService: () => ({ reconcile: async () => {} })
}))
vi.mock('../opencode/opencode-status-plugin-startup-refresh', () => ({
  refreshInstalledOpenCodeStatusPlugins: state.refreshOpenCodePlugins
}))
vi.mock('./helixd-app-paths', () => ({
  resolveHelixdInstallRoot: () => state.root,
  resolveHelixdPath: () => state.root,
  resolveUserDataPath: () => state.root
}))
// Migration otherwise targets the real credential directory.
vi.mock('./helixd-plaintext-credential-migration', () => ({
  helixdCredentialRoot: () => state.root,
  migratePlaintextCredentials: () => ({ sealed: 0, failed: 0 })
}))
vi.mock('./helixd-account-services', () => ({ createHelixdAccountServices: () => null }))
vi.mock('./helixd-browser-provider', () => ({
  resolveHelixdBrowserProvider: state.browserProvider
}))
vi.mock('./helixd-instance-lock', () => ({
  acquireHelixdInstanceLock: () => ({
    path: join(state.root, 'helixd.lock'),
    record: { pid: process.pid, startedAtMs: null, nonce: 'headless-instance' },
    release() {}
  })
}))
vi.mock('./helixd-daemon-supervision', () => ({
  startHelixdDaemon: state.startDaemon,
  stopHelixdDaemon: async () => {}
}))
vi.mock('./helixd-health', () => ({ collectHelixdHealth: async () => ({}) }))
vi.mock('./helixd-automations', () => ({
  startHelixdAutomations: () => {},
  stopHelixdAutomationScheduler: () => {},
  helixdAutomationsKeepHostBusy: () => false
}))
// Prevent network rule downloads in this unit test.
vi.mock('../runtime/agent-state-rules/agent-state-rules-live-update', () => ({
  startAgentStateRulesLiveUpdates: () => {}
}))
vi.mock('../daemon/daemon-provider-state', () => ({ daemonOwnsFreshPersistentPtys: () => false }))
vi.mock('../ipc/pty/register-headless-runtime', () => ({
  registerHeadlessPtyRuntime: async () => {}
}))
vi.mock('../ipc/pty/provider/registry', () => ({ getLocalPtyProvider: () => null }))
vi.mock('./helixd-profile-state-startup', () => ({
  createHelixdProfileStateStartup: async () => {
    const error = state.profileStartupErrors.shift()
    if (error) {
      throw error
    }
    return {
      store: {
        getSettings: () => profile.settings,
        onSettingsChanged: state.onSettingsChanged,
        flushFinalOrThrowAsync: async () => {},
        freezeWritesAsync: async () => {}
      },
      authority: {
        backend: 'sqlite',
        classification: 'neither',
        authority_mode: 'sqlite-candidate',
        runtime: 'helixd',
        migrated: false
      }
    }
  }
}))
vi.mock('../helix-profiles/profile-index-store', () => ({
  initHelixProfilePaths() {},
  ensureActiveHelixProfile: () => ({
    dataFile: join(state.root, 'profile.json'),
    stateDatabaseFile: join(state.root, 'profile-state.db'),
    profile: { id: 'headless-profile' }
  })
}))
vi.mock('../ssh/ssh-host-key-store', () => ({ initSshHostKeyStoreFile() {} }))
vi.mock('../server/serve-readiness', () => ({
  ServeReadinessPublisher: class {
    async publish() {}
  }
}))
vi.mock('../runtime/helix-runtime', () => ({
  HelixRuntimeService: class {
    readonly sidebarFacts = null
    readonly agentTransitions = { seedRestoredRows() {} }
    attachAgentStatusStore() {
      return () => {}
    }
    getRuntimeId() {
      return 'headless-runtime'
    }
    rehydrateClientHostedBrowserPages() {}
    restoreHostAccountLaunchEnv() {}
    async refreshRestoredOrchestrationAuthority() {}
    async reconcileLegacyWorkerTerminals() {}
    async installPendingHelixdMigrationShellHistory() {}
    async stopLegacyWorkerTerminalRecovery() {}
    async closeNotificationDismissals() {}
    flushPaneGrids() {
      return null
    }
    syncWindowGraph() {}
    setMobilePushRegistrar(
      registrar: Parameters<RuntimeMobileNotificationController['setPushRegistrar']>[0]
    ) {
      state.controller!.setPushRegistrar(registrar)
    }
    onNotificationDispatched(
      listener: Parameters<RuntimeMobileNotificationController['onDispatched']>[0]
    ) {
      return state.controller!.onDispatched(listener)
    }
  }
}))
vi.mock('../runtime/runtime-rpc', () => ({
  HelixRuntimeRpcServer: class {
    async start() {
      state.rpcStarted = true
    }
    async stop() {
      state.rpcStarted = false
    }
    getWebSocketEndpoint() {
      return null
    }
    getE2EEKeypair() {
      expect(state.rpcStarted).toBe(true)
      return createPushHostKeypair()
    }
    getDeviceRegistry() {
      return state.registry
    }
    getPushUnregisterOutbox() {
      return new PushUnregisterOutbox(state.root)
    }
    setOnPushUnregisterQueued() {}
  }
}))
vi.mock('../runtime/push/push-gateway-client', () => ({
  PushGatewayClient: class {
    registerDevice = state.register
    send = state.send
    async deleteDevice() {
      return { deleted: true, retryable: false }
    }
  }
}))

beforeEach(() => {
  // Restore the prior data-root env after startHelixd canonicalizes it.
  vi.stubEnv('HELIX_USER_DATA_PATH', '')
  state.onSettingsChanged.mockReturnValue(state.removeSettingsListener)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(state.root, { recursive: true, force: true })
  state.profileStartupErrors.length = 0
  profile.settings = {}
  vi.clearAllMocks()
})

it('refuses recovery overlap before initializing the browser provider or runtime', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'helix-headless-recovery-'))
  const maintenance = acquireProfileStateMaintenance(state.root)
  const { startHelixd, parseArgs } = await import('./helixd-entry')
  const commandArguments = await import('./helixd-command-arguments')
  try {
    expect(parseArgs).toBe(commandArguments.parseArgs)
    await expect(startHelixd({ noPairing: true, json: true })).rejects.toThrow()
    expect(state.browserProvider).not.toHaveBeenCalled()
    expect(state.rpcStarted).toBe(false)
  } finally {
    maintenance.release()
  }
})

it('keeps push off on the host and cleans up on shutdown', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'helix-headless-push-'))
  state.controller = new RuntimeMobileNotificationController()
  state.registry = new DeviceRegistry(state.root)
  const phone = state.registry.addDevice('headless-phone', 'mobile')
  const { startHelixd } = await import('./helixd-entry')
  const host = await startHelixd({ noPairing: true, json: true })
  try {
    // The phone companion is out of this release, so the host never registers push devices.
    const result = await state.controller.registerPushDevice({
      deviceId: phone.deviceId,
      platform: 'android',
      token: 'test-token',
      filter: { onlyWhenDesktopAway: true }
    })
    expect(result).toMatchObject({ registered: false })
    expect(state.send).not.toHaveBeenCalled()
  } finally {
    await host.stop()
  }
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
  expect(state.controller.getListenerCount()).toBe(0)
  expect(state.rpcStarted).toBe(false)
  expect(state.onSettingsChanged).toHaveBeenCalledOnce()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
  await host.stop()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
})

it('releases admission when host setup fails before a runtime exists', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'helix-headless-setup-failure-'))
  state.profileStartupErrors.push(new Error('profile startup failed'))
  const { startHelixd } = await import('./helixd-entry')
  await expect(startHelixd()).rejects.toThrow('profile startup failed')
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
})

it('serves RPC without waiting for browser discovery', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'helix-headless-browser-pending-'))
  let finishDiscovery!: () => void
  state.browserProvider.mockReturnValueOnce(
    new Promise<null>((resolve) => {
      finishDiscovery = () => resolve(null)
    })
  )
  const { startHelixd } = await import('./helixd-entry')
  const host = await startHelixd({ noPairing: true, json: true })
  expect(host.managedStop).toMatchObject({
    runtimeId: 'headless-runtime',
    instance: { pid: process.pid, nonce: 'headless-instance' }
  })
  finishDiscovery()
  await host.stop()
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
})

it('unsubscribes settings when daemon startup fails after hook setup', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'helix-headless-daemon-failure-'))
  state.startDaemon.mockRejectedValueOnce(new Error('daemon setup failed'))
  const { startHelixd } = await import('./helixd-entry')
  await expect(startHelixd()).rejects.toThrow('daemon setup failed')
  expect(state.onSettingsChanged).toHaveBeenCalledOnce()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
})

it('installs agent status hooks on the host when it starts', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'helix-headless-hooks-'))
  const { startHelixd } = await import('./helixd-entry')
  const host = await startHelixd({ noPairing: true, json: true })
  try {
    expect(state.startCodexHooks).toHaveBeenCalledOnce()
    expect(state.startCodexHooks.mock.calls[0]![0].resolveLaunchHome()).toBeNull()
    await vi.waitFor(() =>
      expect(state.installManagedAgentHooks).toHaveBeenCalledWith(
        profile.settings,
        expect.objectContaining({ shouldHydrateShellPath: true })
      )
    )
    expect(state.refreshOpenCodePlugins).toHaveBeenCalledWith(profile.settings)
    expect(state.adoptLoginShellAgentHomes.mock.invocationCallOrder[0]).toBeLessThan(
      state.installManagedAgentHooks.mock.invocationCallOrder[0]!
    )
  } finally {
    await host.stop()
  }
})

it('leaves agent configs alone when status hooks are off', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'helix-headless-hooks-off-'))
  profile.settings = { agentStatusHooksEnabled: false }
  const { startHelixd } = await import('./helixd-entry')
  const host = await startHelixd({ noPairing: true, json: true })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.installManagedAgentHooks).not.toHaveBeenCalled()
    expect(state.startCodexHooks.mock.calls[0]![0].isEnabled()).toBe(false)
  } finally {
    await host.stop()
  }
})
