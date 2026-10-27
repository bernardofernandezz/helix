import { getAppEnvironment } from '../../../shared/app-environment'
import {
  getManagedHelixdFenceEnvironmentId,
  managedHelixdServerName
} from '../../../shared/managed-helixd-ssh-owner'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { findHelixdMigrationSourceCutoverForTarget } from '../../ssh/helixd-migration-cutover-journal'
import { abandonHelixdConversion } from '../../ssh/helixd-conversion-abandon'
import { retainHelixdMigrationSource } from '../../ssh/helixd-migration-source-retention'
import { hasHelixdTemplate } from '../../helixd/helixd-artifact-materializer'
import { isHelixdHostUnavailableFixableOnHost } from '../../helixd/helixd-host-unavailable'
import { managedServerUpdateDeps } from '../../ssh/managed-server-update-deps'
import { ensureHelixdManagedTunnel } from '../../managed-server/lifecycle/helixd-managed-tunnel'
import { verifyHelixdManagedServing } from '../../managed-server/lifecycle/helixd-managed-serving-verify'
import { convertSshTargetToManagedHelixd } from '../../managed-server/lifecycle/helixd-runtime-conversion'
import {
  helixdMigrationDestinationFor,
  helixdServerFolderCatalogFor,
  helixdServerRepositoriesFor
} from '../../managed-server/lifecycle/helixd-runtime-conversion-wiring'
import { createManagedHelixdEnvironment } from '../../managed-server/lifecycle/helixd-runtime-deployment'
import type { HostServerOnConnectDeps } from '../../ssh/ssh-host-server-on-connect'
import {
  censusSshHostRelaysBeforeSession,
  relayTerminalsOnConnect
} from '../../ssh/legacy-relay/ssh-host-relay-terminals-on-connect'
import { requireManagedHelixdInfrastructure } from '../../managed-server/lifecycle/helixd-managed-runtime-context'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { setSshHostServerStatus } from '../../ssh/ssh-host-server-status'
import { trackSshHostServerEvent } from '../../ssh/ssh-host-server-telemetry'
import { knownSshHostPlatform } from '../../ssh/ssh-host-platform-memo'
import { knownHelixdTunnelTransport } from '../../ssh/helixd-tunnel-transport-memo'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { releaseUnreachableHelixdSetup } from '../../ssh/helixd-unreachable-setup-release'
import { getCurrentMainWindow } from './ssh-ipc-context'
import { broadcastSshState } from './ssh-renderer-broadcast'
import { connectInFlight } from './ssh-connect-attempt-registry'
import { startLegacyRelayBridge } from '../../ssh/legacy-relay/legacy-relay-bridge-registry'
import { isBridgeableLease } from '../../ssh/legacy-relay/legacy-relay-bridge-leases'

export function hostServerOnConnectDeps(userDataPath: string): HostServerOnConnectDeps {
  const registry = getSshTargetRegistryStore()!
  const claims = registry.getHelixdRuntimeClaims()
  const store = registry.getHelixdMigrationSource()
  const appVersion = getAppEnvironment().getVersion()
  const isRegistered = (environmentId: string): boolean =>
    listEnvironments(userDataPath).some((entry) => entry.id === environmentId)
  return {
    // A fence alone may be unfinished setup; only registered servers count.
    managedEnvironmentId: (target) => {
      const environmentId = getManagedHelixdFenceEnvironmentId(target)
      return environmentId && isRegistered(environmentId) ? environmentId : null
    },
    ensureTunnel: async (environmentId) => {
      await ensureHelixdManagedTunnel(userDataPath, environmentId)
    },
    ensureServing: (environmentId) => verifyHelixdManagedServing(userDataPath, environmentId),
    retainCommittedSource: async (target) => {
      const head = findHelixdMigrationSourceCutoverForTarget(userDataPath, target.id)
      if (head?.phase === 'destination-committed') {
        await retainHelixdMigrationSource(userDataPath, head.migrationId, store)
      }
    },
    hasTemplate: hasHelixdTemplate,
    recordedUnavailable: (target) =>
      target.managedServerUnavailable?.appVersion === appVersion
        ? target.managedServerUnavailable.reason
        : null,
    recordUnavailable: (target, reason) => {
      if (!isHelixdHostUnavailableFixableOnHost(reason)) {
        registry.updateTarget(target.id, { managedServerUnavailable: { reason, appVersion } })
      }
    },
    ...managedServerUpdateDeps(userDataPath),
    isEmptyHost: (target) => {
      // An interrupted empty-host deploy passes its own claim, recorded by its provisioning intent.
      const environmentId = getManagedHelixdFenceEnvironmentId(target)
      return claims.preflight(
        target.id,
        environmentId
          ? { environmentId, recorded: target.helixdProvisioning !== undefined }
          : undefined
      ).claimable
    },
    relayTerminals: (target) =>
      relayTerminalsOnConnect({
        store,
        targetId: target.id,
        censusHost: async () =>
          censusSshHostRelaysBeforeSession(
            await requireManagedHelixdInfrastructure().connectionManager.connect(target),
            target.id
          )
      }),
    deploy: (target) =>
      createManagedHelixdEnvironment(userDataPath, {
        name: target.helixdProvisioning?.name ?? managedHelixdServerName(target),
        sshTargetId: target.id
      }),
    convert: async (target, hostProof) => {
      // COMPAT(legacy-relay-bridge): find the panes old relays still run before the tabs remount.
      if (hostProof?.bridged) {
        await startLegacyRelayBridge(target.id)
      }
      const converted = await convertSshTargetToManagedHelixd(userDataPath, {
        sshTargetId: target.id,
        name: managedHelixdServerName(target),
        // The connect's own census already answered; a conversion before any session reuses it.
        censusHost: (host) =>
          hostProof ? Promise.resolve(hostProof) : censusHostRelayTerminalsFor(host)(),
        isBridgedPaneLease: isBridgeableLease,
        // Releasing the direct session here would cancel the connect that requested conversion.
        destinationFor: helixdMigrationDestinationFor,
        serverRepositoriesFor: helixdServerRepositoriesFor,
        serverFolderCatalogFor: helixdServerFolderCatalogFor
      })
      if (converted.outcome === 'converted' || converted.outcome === 'refused') {
        // Move-anyway consent covers one attempt; retain it on failure so held-fence verification can resume.
        registry.updateTarget(target.id, { managedServerLeaveBehind: undefined })
      }
      return converted
    },
    abandonDeploy: async (target) => {
      const environmentId =
        getManagedHelixdFenceEnvironmentId(target) ??
        getManagedHelixdFenceEnvironmentId(registry.getTarget(target.id))
      if (environmentId && !isRegistered(environmentId)) {
        claims.release(target.id, environmentId)
        await claims.flush()
      }
    },
    hasUnfinishedConversion: (target) => {
      const head = findHelixdMigrationSourceCutoverForTarget(userDataPath, target.id)
      return (
        head !== null &&
        !head.supersedesMigrationId &&
        (head.phase === 'source-fenced' || head.phase === 'destination-staged')
      )
    },
    abandonConversion: async (target) => {
      await abandonHelixdConversion({
        userDataPath,
        store,
        claims,
        targetId: target.id,
        destinationFor: helixdMigrationDestinationFor
      })
    },
    isFencedBeforeStaging: (target) =>
      findHelixdMigrationSourceCutoverForTarget(userDataPath, target.id)?.phase === 'source-fenced',
    releaseUnreachableSetup: (target) =>
      releaseUnreachableHelixdSetup({ userDataPath, claims, targetId: target.id }),
    // Read at report time: a deploy or conversion learns the platform while the decision runs.
    report: (target, event) =>
      trackSshHostServerEvent(
        event,
        knownSshHostPlatform(target.id),
        knownHelixdTunnelTransport(target.id)
      ),
    progress: (target, phase) => {
      // Cancelled decisions keep running; their progress must not revive connection status.
      if (!connectInFlight.has(target.id)) {
        return
      }
      setSshHostServerStatus(target.id, { kind: 'setting-up', phase })
      broadcastSshState(getCurrentMainWindow, target.id, {
        targetId: target.id,
        status: 'connecting',
        error: null,
        reconnectAttempt: 0
      })
    }
  }
}
