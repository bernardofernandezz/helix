/** Use the managed SSH repair gate for refused WSL enrollment: serialize, cap attempts and require the pinned host key. Read new offers inside the local distro. */
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import {
  findWslHostDeployment,
  refreshWslHostPairing
} from '../../shared/runtime-environment-wsl-host-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { readActiveManagedHelixdReadiness } from '../managed-server/lifecycle/helixd-managed-bound-port'
import {
  ManagedHelixdPairingRepairs,
  type ManagedHelixdPairingRepairDeps
} from '../managed-server/lifecycle/helixd-managed-pairing-repair'
import type { WslHelixdHostTransport } from './wsl-helixd-host-transport'
import { HelixdManagedPairingRepairFailedError } from '../managed-server/lifecycle/helixd-managed-pairing-repair-failure'
import { notifyManagedHelixdPairingRepaired } from '../managed-server/lifecycle/helixd-managed-pairing-repaired-listener'
import type { WslHelixdHostTarget } from './wsl-helixd-host-target'
import { createWslHelixdHostTransport } from './wsl-helixd-host-transport'
import type { WslHelixdPairingRecovery } from './wsl-helixd-pairing-identity'

type WslHelixdHostAccess = { target: WslHelixdHostTarget; connection: WslHelixdHostTransport }

export function liveWslHelixdPairingRepairDeps(
  userDataPath: string
): ManagedHelixdPairingRepairDeps<WslHelixdHostAccess> {
  const record = (environmentId: string) => {
    const found = findWslHostDeployment(userDataPath, environmentId)
    if (!found) {
      throw new HelixdManagedPairingRepairFailedError('this server is not a WSL host')
    }
    return found
  }
  return {
    resolve: (environmentId) => resolveEnvironment(userDataPath, environmentId),
    connect: async (environment: KnownRuntimeEnvironment) => {
      const target: WslHelixdHostTarget = {
        kind: 'wsl',
        id: environment.id,
        distro: record(environment.id).distro,
        label: environment.name
      }
      return { target, connection: createWslHelixdHostTransport({ target }) }
    },
    readReadiness: async (access) => {
      try {
        return await readActiveManagedHelixdReadiness(access)
      } finally {
        access.connection.dispose()
      }
    },
    ports: (environment) => {
      const found = findWslHostDeployment(userDataPath, environment.id)
      return found ? { localPort: found.localPort, remotePort: found.remotePort } : null
    },
    refresh: (environmentId, pairingCode) => {
      const { localPort, remotePort } = record(environmentId)
      return refreshWslHostPairing(userDataPath, environmentId, {
        pairingCode,
        localPort,
        remotePort
      }).environment
    },
    repaired: notifyManagedHelixdPairingRepaired,
    now: Date.now
  }
}

/** One gate per desktop, so the cap and a standing failure hold across every WSL connect. */
export function createWslHelixdPairingRecovery(
  userDataPath: string,
  deps: ManagedHelixdPairingRepairDeps<WslHelixdHostAccess> = liveWslHelixdPairingRepairDeps(
    userDataPath
  )
): Omit<WslHelixdPairingRecovery, 'environmentId'> {
  return { repairs: new ManagedHelixdPairingRepairs(deps), resolve: deps.resolve }
}
