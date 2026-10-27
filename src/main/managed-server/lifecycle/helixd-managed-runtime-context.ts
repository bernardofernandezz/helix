import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import { HELIXD_UPDATE_TERMINALS_RUNNING_CODE } from '../../../shared/helixd-managed-runtime'
import {
  getHelixdSshDeployment,
  type KnownRuntimeEnvironment,
  type HelixdSshDeploymentLink
} from '../../../shared/runtime-environments'
import { getManagedHelixdFenceEnvironmentId } from '../../../shared/managed-helixd-ssh-owner'
import type { ServeReadiness } from '../../server/serve-readiness'
import { computeLocalHelixdBuildHash } from '../../ssh/helixd-local-build-hash'
import { sshHelixdHostTransport } from '../../ssh/helixd-ssh-host-transport'
import type { HelixdHostTarget } from '../../ssh/helixd-host-transport'
import type { HelixdActivationRecord } from '../activation/helixd-activation-record'
import {
  admitHelixdRecordForIntent,
  type HelixdUpdateIntent
} from './helixd-managed-update-decision'
import {
  type HelixdTerminalCensus,
  UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
} from '../../../shared/helixd-terminal-census'
import { probeActiveHelixdReadiness } from '../../ssh/helixd-active-readiness'
import {
  resolveHelixdRemoteContext,
  type HelixdRemoteContext
} from '../install/helixd-remote-context'
import { HELIXD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'

const HELIXD_BIND_HOST = '127.0.0.1'

// Pinned slots must fail on absent markers rather than silently use host Node.
const MANAGED_HELIXD_LEGACY_NODE_PATH = ''

export function requireManagedHelixdInfrastructure() {
  const targetStore = requireManagedHelixdTargetStore()
  const connectionManager = getSshConnectionManager()
  if (!connectionManager) {
    throw new Error('SSH is unavailable on this client; this host’s Helix server is unverifiable.')
  }
  return { connectionManager, targetStore, claims: targetStore.getHelixdRuntimeClaims() }
}

export function requireManagedHelixdTargetStore() {
  const targetStore = getSshTargetRegistryStore()
  if (!targetStore) {
    throw new Error('SSH target state is unavailable; this host’s Helix server is unverifiable.')
  }
  return targetStore
}

export function requireManagedHelixdEnvironment(
  userDataPath: string,
  selector: string
): { environment: KnownRuntimeEnvironment; deployment: HelixdSshDeploymentLink } {
  const environment = resolveEnvironment(userDataPath, selector)
  const deployment = getHelixdSshDeployment(environment)
  if (!deployment || environment.connectionDependency !== 'ssh-tunnel') {
    throw new Error('This server is not managed through an helixd SSH deployment.')
  }
  return { environment, deployment }
}

export async function resolveLinkedHelixdContext(
  environment: KnownRuntimeEnvironment,
  deployment: HelixdSshDeploymentLink,
  signal?: AbortSignal
): Promise<HelixdRemoteContext> {
  const { connectionManager, targetStore } = requireManagedHelixdInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  if (
    !target ||
    target.generation !== deployment.sshTargetGeneration ||
    getManagedHelixdFenceEnvironmentId(target) !== environment.id
  ) {
    throw new Error('The SSH registration for this host’s Helix server is no longer valid.')
  }
  const connection = await connectionManager.connect(target)
  return resolveHelixdRemoteContext(target, sshHelixdHostTransport(connection), signal)
}

export function managedHelixdSlot(
  context: HelixdRemoteContext<HelixdHostTarget>,
  port: number,
  signal?: AbortSignal
) {
  return {
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    nodePath: MANAGED_HELIXD_LEGACY_NODE_PATH,
    userDataDir: context.userDataDir,
    bindHost: HELIXD_BIND_HOST,
    port,
    signal
  }
}

export function managedHelixdInstallDir(
  context: HelixdRemoteContext<HelixdHostTarget>,
  version: string
): string {
  return computeRemoteInstallDir(
    HELIXD_INSTALL_MODEL,
    context.remoteHome,
    version,
    context.host.pathFlavor
  )
}

/** Accept readiness only from the build this client holds. */
export function probeManagedHelixdReadiness(
  context: HelixdRemoteContext<HelixdHostTarget>,
  localHelixdDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<ServeReadiness> {
  return probeActiveHelixdReadiness(
    {
      conn: context.connection,
      host: context.host,
      remoteInstallDir: managedHelixdInstallDir(context, fullVersion),
      signal
    },
    { buildHash: computeLocalHelixdBuildHash(localHelixdDir), fullVersion }
  )
}

export function managedHelixdDeployPolicy(
  context: Pick<HelixdRemoteContext<HelixdHostTarget>, 'activationRecord'>,
  appVersion: string,
  intent: HelixdUpdateIntent
): {
  census: HelixdTerminalCensus
  recountCensus: () => Promise<HelixdTerminalCensus>
  releaseIncumbentAdmission: () => Promise<void>
  censusRecord: HelixdActivationRecord
  admitRecord: (record: HelixdActivationRecord, candidateVersion: string) => string | null
} {
  // Only the active daemon can count sessions; guessing zero risks restarting live terminals.
  const census: HelixdTerminalCensus = context.activationRecord.active
    ? UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
    : { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  return {
    census,
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    censusRecord: context.activationRecord,
    // Only the fenced read can reject newer migrated state or rolled-back builds on this unlinked path.
    admitRecord: admitHelixdRecordForIntent(intent, appVersion)
  }
}

// Force can override live terminal counts, never unknown census or protocol deferrals.
export function isForceableHelixdDeferral(code: string): boolean {
  return code === HELIXD_UPDATE_TERMINALS_RUNNING_CODE
}
