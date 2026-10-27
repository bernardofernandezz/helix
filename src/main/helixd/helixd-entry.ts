// Compose the Node-host runtime; paired desktop pages work even without a local browser engine.
import process from 'node:process'
import { getAppEnvironment } from '../../shared/app-environment'
import { resolveHelixdInstallRoot, resolveUserDataPath } from './helixd-app-paths'
import { prepareHelixdCliLauncher } from './helixd-cli-launcher'
import { installHelixdHostAdapters, runHelixdQuitHandlers } from './helixd-host-adapters'
import { prepareHelixdSecretStoreAndMigrate } from './helixd-secret-store-startup'
import { describeHelixdBindExposure, resolveHelixdBindHost } from './helixd-bind-address'
import {
  flushHelixdProfileStoreForShutdown,
  installHelixdShutdownSignals,
  startHelixdWithHost,
  stopHelixdStructuredAgentSessions,
  type HelixdShutdownTrigger
} from './helixd-lifecycle'
import { HELIXD_USAGE, parseArgs, resolveHelixdWebClientRoot } from './helixd-command-arguments'
import type { HelixdRuntimeCleanup } from './helixd-runtime-lifetime'
import { installHelixdStopRequestListeners } from './helixd-stop-request-listener'
import { prepareHelixdManagedStop } from './helixd-managed-stop-admission'
import { bindHelixdStopTerminalAdmission } from './helixd-stop-terminal-admission'
import type { HelixdHandle, HelixdOptions } from './helixd-start-contract'
import { beginHelixdIdleExit, bindHelixdIdleShutdown } from './helixd-managed-idle-exit-host'
import { helixdAutomationsKeepHostBusy, startHelixdAutomations } from './helixd-automations'
import { changedAiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import type { AiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import { stampRuntimeSourceEnv } from '../../shared/runtime-source-env'
import { adoptWslHostLoginEnvironment } from './helixd-wsl-host-login-environment'
import { installHelixdProcessErrorGuards } from './helixd-process-error-guards'
import { helixdWsPortOptions } from './helixd-ws-port-policy'
import { HELIX_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import { placeUnshownLiveTerminalsBestEffort } from '../runtime/terminal/adoption/unshown-live-terminal-placement'

export { parseArgs }

let closeHelixdObservability = (): void => {}

/** Resolve after transport readiness publishes the desktop-compatible serve payload. */
export async function startHelixd(options: HelixdOptions = {}): Promise<HelixdHandle> {
  installHelixdHostAdapters()
  // Inherited terminal identity must not fence helixd’s CLI children to the launching desktop.
  stampRuntimeSourceEnv(process.env, null)
  const userDataPath = resolveUserDataPath()
  // Override inherited data roots so CLI-shared Codex homes resolve on this host.
  process.env.HELIX_USER_DATA_PATH = userDataPath
  const { readiness, instance, stop } = await startHelixdWithHost(
    userDataPath,
    (registerCleanup) => startHelixdRuntime(options, registerCleanup),
    () => {
      try {
        runHelixdQuitHandlers()
      } finally {
        // Close after quit handlers, including failed ones, so their spans reach disk.
        closeHelixdObservability()
        closeHelixdObservability = () => {}
      }
    }
  )
  const version = getAppEnvironment().getVersion()
  return { readiness, managedStop: { version, runtimeId: readiness.runtimeId, instance }, stop }
}

async function startHelixdRuntime(
  options: HelixdOptions,
  registerCleanup: (cleanup: HelixdRuntimeCleanup) => void
): Promise<Pick<HelixdHandle, 'readiness'>> {
  // Overlap login-shell probing with imports and store startup.
  const loginEnvironment = adoptWslHostLoginEnvironment().then(
    (names) => {
      if (names.length > 0) {
        console.info(`[helixd] adopted login-shell variables: ${names.join(', ')}`)
      }
    },
    (error: unknown) => console.warn('[helixd] could not adopt login-shell variables:', error)
  )
  const { HelixRuntimeService } = await import('../runtime/helix-runtime')
  const { HelixRuntimeRpcServer } = await import('../runtime/runtime-rpc')
  const { registerHeadlessPtyRuntime } = await import('../ipc/pty/register-headless-runtime')
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { installHelixdObservability } = await import('./helixd-observability')
  closeHelixdObservability = installHelixdObservability()
  const { ServeReadinessPublisher } = await import('../server/serve-readiness')
  const { servePublishMode } = await import('../server/serve-pairing-readiness')
  const { buildHelixdServeReadiness } = await import('./helixd-serve-readiness')
  const { createHelixdProfileStateStartup } = await import('./helixd-profile-state-startup')
  const { startHelixdDaemon, stopHelixdDaemon } = await import('./helixd-daemon-supervision')
  const { daemonOwnsFreshPersistentPtys } = await import('../daemon/daemon-provider-state')
  const { collectHelixdHealth } = await import('./helixd-health')
  const { agentHookServer } = await import('../agent-hooks/server')
  const { isAgentStatusHooksEnabled } = await import('../agent-hooks/managed-agent-hook-controls')
  const { agentHookRuntimeDeps } = await import('../agent-hooks/agent-hook-runtime-deps')
  const { installHookStatusSessionTabsRepublish } =
    await import('../agent-hooks/hook-status-session-tabs-republish')
  const { startHelixdManagedAgentHooks } = await import('./helixd-managed-agent-hooks')
  const { AgentStatusObservedPaneIdentities, AgentStatusObservedPaneIdentityCapture } =
    await import('../runtime/agent-status-observed-pane-identity')

  const { disposeWatcherProcessAndWait } =
    await import('../ipc/filesystem/watcher-process/parcel-watcher-process')

  let paneGridsForShutdown: { flushPaneGrids(): Promise<void> | null } | null = null
  let profileStoreForShutdown:
    | { flushFinalOrThrowAsync(): Promise<void>; freezeWritesAsync(): Promise<void> }
    | undefined
  let uninstallHookStatusRepublish = (): void => {}
  let uninstallObservedStatusIdentity = (): void => {}
  // Cleanups run in reverse: RPC, then recovery and watchers, then the final flush, then daemon.
  registerCleanup(() => agentHookServer.stop())
  registerCleanup(() => uninstallHookStatusRepublish())
  registerCleanup(() => uninstallObservedStatusIdentity())
  // Disconnect without killing daemon PTYs that must survive restart.
  registerCleanup(() => stopHelixdDaemon())
  registerCleanup(async () => {
    // A SQLite-backed helixd has no JSON mirror to absorb a debounced write after SIGTERM.
    if (profileStoreForShutdown) {
      await flushHelixdProfileStoreForShutdown(profileStoreForShutdown, paneGridsForShutdown)
    }
  })
  registerCleanup(stopHelixdStructuredAgentSessions)
  registerCleanup(() => disposeWatcherProcessAndWait())

  const runtimeUserDataPath = getAppEnvironment().getPath('userData')
  const { startEventLoopDelayProbe } = await import('../diagnostics/event-loop-delay-probe')
  startEventLoopDelayProbe('helixd', runtimeUserDataPath)
  await prepareHelixdCliLauncher().catch((error: unknown) => {
    console.warn('[helixd] Could not prepare the profile CLI launcher', error)
  })
  const idleExitStartup = beginHelixdIdleExit(runtimeUserDataPath)
  const { helixdSessionScannerIdleTimeoutMs } = await import('./helixd-session-scanner-idle')
  const scannerIdleTimeoutMs = helixdSessionScannerIdleTimeoutMs()
  if (scannerIdleTimeoutMs !== null) {
    const { setAiVaultServiceIdleTimeoutMs } =
      await import('../ai-vault/session-scanner-service-spawn')
    setAiVaultServiceIdleTimeoutMs(scannerIdleTimeoutMs)
  }
  // Initialize sealing before Store load unseals protected settings.
  await prepareHelixdSecretStoreAndMigrate(runtimeUserDataPath)
  const { store: profileStore, authority: profileStateAuthority } =
    await createHelixdProfileStateStartup(runtimeUserDataPath)
  const observedPaneIdentities = new AgentStatusObservedPaneIdentities()
  const observedStatusCapture = new AgentStatusObservedPaneIdentityCapture(observedPaneIdentities)
  profileStoreForShutdown = profileStore
  uninstallObservedStatusIdentity = agentHookServer.subscribeEnrichedStatus((enriched) =>
    observedStatusCapture.observe(enriched)
  )
  // Subscribe before hooks start so early turns are counted.
  const { startHelixdStats } = await import('./helixd-stats')
  const stats = startHelixdStats(runtimeUserDataPath, agentHookServer, registerCleanup)
  await agentHookServer.start({
    env: 'production',
    userDataPath: runtimeUserDataPath,
    statusHooksEnabled: isAgentStatusHooksEnabled(profileStore.getSettings())
  })

  // Reconcile, daemon and runtime all consume this environment.
  await loginEnvironment
  startHelixdManagedAgentHooks(
    profileStore,
    (enabled) => agentHookServer.setStatusHooksEnabled(enabled),
    registerCleanup
  )

  // Install the daemon provider before PTY handlers can route their first call.
  await startHelixdDaemon()

  // Runtime constructor callbacks use this index only after it is installed.
  let sessionSearch: { apply(settings: AiVaultSearchSettings): void; dispose(): void } | null = null

  const { helixdCodexAccountHomes } = await import('./helixd-codex-account-homes')
  const codexAccountHomes = helixdCodexAccountHomes(
    () => profileStore.getSettings(),
    registerCleanup
  )

  const { createHelixdAccountServices } = await import('./helixd-account-services')
  const accountLaunch = createHelixdAccountServices({
    store: profileStore,
    setClaudeStatusLineListener: (listener) =>
      agentHookServer.setClaudeStatusLineListener(listener),
    registerCleanup,
    clientCodexHomes: codexAccountHomes
  })

  const { loadAgentSessionClaimSigner } =
    await import('../runtime/agent-session/ownership/agent-session-claim-identity')
  const runtime = new HelixRuntimeService(profileStore, stats, {
    // Persistent signatures let restarted runtimes adopt PTYs owned before restart.
    agentSessionClaimSigner: loadAgentSessionClaimSigner(runtimeUserDataPath, runtimeUserDataPath),
    getAdditionalAiVaultCodexHomePaths: () => [
      ...codexAccountHomes.listSessionHomes(),
      ...(accountLaunch?.listCodexSessionHomes() ?? [])
    ],
    // WSL must retain desktop-pushed CODEX_HOME instead of host-selected resolvers.
    ...accountLaunch?.runtimeDeps,
    ...agentHookRuntimeDeps(agentHookServer, observedPaneIdentities, () =>
      profileStore.getSettings()
    ),
    // Resolve lazily because daemon swaps replace the provider after construction.
    getLocalProvider: () => getLocalPtyProvider(),
    // Read current daemon ownership; failed/degraded launch cannot claim fresh PTY persistence.
    canRecoverPersistentLocalPtys: () => daemonOwnsFreshPersistentPtys(),
    // Node hosts cannot promote into desktop windows; override the constructor’s openable default.
    getDesktopWindowStatus: () => 'blocked',
    // Unchanged settings would reconstruct a healthy search index; deduplicate before apply.
    applySessionSearchSettings: (before, after) => {
      const next = changedAiVaultSearchSettings(before, after)
      if (next) {
        sessionSearch?.apply(next)
      }
    }
  })
  paneGridsForShutdown = runtime

  accountLaunch?.attachToRuntime(runtime)

  // Restore prior desktop-pushed account selection before automations or CLI launches.
  const { restoreHelixdHostAccountLaunchEnv } =
    await import('./helixd-host-account-launch-env-store')
  restoreHelixdHostAccountLaunchEnv(runtime, runtimeUserDataPath)

  const { installHelixdSessionSearchService } = await import('./helixd-session-search')
  sessionSearch = await installHelixdSessionSearchService({
    userDataPath: runtimeUserDataPath,
    getSettings: () => profileStore.getSettings()
  })
  getAppEnvironment().onWillQuit(() => sessionSearch?.dispose())

  const { startAgentStateRulesLiveUpdates } =
    await import('../runtime/agent-state-rules/agent-state-rules-live-update')
  startAgentStateRulesLiveUpdates(profileStore, (rules) =>
    console.info(`[helixd] agent state rules ${rules.version} (${rules.source})`)
  )
  if (HELIX_LAYOUT_OWNER_IS_MAIN) {
    const { repairDuplicatePtyPanesOnStart } = await import('../runtime/moved-pane-owner-rekey')
    // Wait behind earlier writes and persist repair before reconciliation/RPC admission.
    await repairDuplicatePtyPanesOnStart(profileStore, runtime)
  }

  // Status changes must republish session.tabs to paired clients.
  uninstallHookStatusRepublish = installHookStatusSessionTabsRepublish(
    agentHookServer,
    () => runtime
  )
  registerCleanup(runtime.attachAgentStatusStore(agentHookServer))

  // Headless registration threads Store into persistence; account homes prefer client then host selection.
  // WSL has no host selection and keeps the desktop-prepared environment.
  await registerHeadlessPtyRuntime(
    runtime,
    async (target, launchEnv, context) =>
      (await codexAccountHomes.selectLaunchHome(target, launchEnv, context)) ??
      (accountLaunch ? accountLaunch.prepareCodexHome(target, launchEnv, context) : null),
    () => profileStore.getSettings(),
    accountLaunch?.prepareClaudeAuth,
    profileStore,
    accountLaunch?.prepareCodexSessionResume
  )

  // Recover browser/orchestration authority before clients attach to the runtime graph.
  runtime.rehydrateClientHostedBrowserPages()

  await runtime.refreshRestoredOrchestrationAuthority()
  await runtime.reconcileLegacyWorkerTerminals()
  if (HELIX_LAYOUT_OWNER_IS_MAIN) {
    await placeUnshownLiveTerminalsBestEffort(runtime)
  }
  runtime.agentTransitions.seedRestoredRows()
  void runtime.sidebarFacts?.reconcileSortStampTiers(getLocalPtyProvider())

  // Run after RPC stops; later dismissal records save synchronously until exit.
  registerCleanup(() => runtime.closeNotificationDismissals())
  // Stop recovery retries before final profile flush.
  registerCleanup(() => runtime.stopLegacyWorkerTerminalRecovery())

  // Recovery establishes terminal/dispatch identities before fencing observations.
  observedStatusCapture.attach(runtime)
  agentHookServer.setCliWriterExecutionMatcher(observedPaneIdentities, runtime)
  // First RPC clients must see a fully published graph.
  const { publishHeadlessRuntimeGraph } = await import('../runtime/headless-runtime-graph')
  publishHeadlessRuntimeGraph(runtime)
  // Only the runtime can identify running shells and install deferred migrated history.
  void runtime.installPendingHelixdMigrationShellHistory().catch((error: unknown) => {
    console.error('[helixd-migration] installing pending shell history failed:', error)
  })

  const bindHost = resolveHelixdBindHost(options.bind)
  bindHelixdStopTerminalAdmission(runtime.terminalUpdateAdmission)
  const rpc = new HelixRuntimeRpcServer({
    runtime,
    userDataPath: runtimeUserDataPath,
    enableWebSocket: true,
    // Pin operator exposure across restarts; pairing must not silently widen a loopback bind.
    pinnedBindHost: bindHost,
    webClientRoot: resolveHelixdWebClientRoot(options.webClientRoot),
    ...helixdWsPortOptions(options.port)
  })
  // Stop RPC before cleanup can tear down writers and runtime state.
  registerCleanup(() => rpc.stop())
  await rpc.start()
  startHelixdAutomations(runtime, profileStore, registerCleanup)
  console.error(`[helixd] ${describeHelixdBindExposure(bindHost)}`)

  const readiness = await buildHelixdServeReadiness({
    options,
    runtimeId: runtime.getRuntimeId(),
    rpc,
    collectHealth: () =>
      collectHelixdHealth(
        getAppEnvironment().getVersion(),
        profileStateAuthority,
        idleExitStartup.previousIdleStop
      )
  })

  await new ServeReadinessPublisher().publish(readiness, servePublishMode(options))

  await idleExitStartup.start({
    rpc,
    agentStates: () => agentHookServer.getStatusSnapshot(),
    hasStagedMigration: () => profileStore.hasStagedHelixdMigrationCatalog(),
    automationsBusy: () => helixdAutomationsKeepHostBusy(profileStore),
    registerCleanup
  })
  return { readiness }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(HELIXD_USAGE)
    return
  }
  let shutdownTrigger: HelixdShutdownTrigger | null = null
  // Fire-and-forget startup work can reject before its first await completes.
  installHelixdProcessErrorGuards(() => shutdownTrigger)
  const startup = startHelixd(options)
  const requestShutdown = installHelixdShutdownSignals(async () => (await startup).stop())
  shutdownTrigger = requestShutdown
  const handle = await startup
  // Stop requests must name the runtime/instance established by startup.
  installHelixdStopRequestListeners(() => requestShutdown('stop request'), {
    installRoot: resolveHelixdInstallRoot(),
    managedStop: handle.managedStop,
    beforeManagedStop: prepareHelixdManagedStop
  })
  bindHelixdIdleShutdown(requestShutdown)
}
