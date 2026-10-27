import { createWslHelixdPairingRecovery } from './wsl-helixd-pairing-repair'
import { readConfirmedRunningWslDistros } from '../wsl-background-distro-gate'
import { parsePairingCode } from '../../shared/pairing'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { verifyHelixdPairingIdentity } from '../managed-server/lifecycle/helixd-managed-tunnel-identity'
import { resolveEnvironmentPairingOffer } from '../../shared/runtime-environment-store'
import { findWslHostDeployment } from '../../shared/runtime-environment-wsl-host-store'
import { createWslDistroHolder, type WslDistroHolder } from './wsl-distro-holder'
import { listWslHostDistros } from './wsl-host-distro-list'
import type { WslHostConnector, WslHostReachability } from './wsl-host-service'
import { readWslDistroHelixdPublicKey } from './wsl-host-ssh-helixd-conflict'
import {
  WslHelixdConnectionManager,
  type WslHelixdConnection,
  type WslHelixdConnectionDependencies
} from './wsl-helixd-connection'
import { defaultWslHelixdEnvironmentId, deployAndLaunchWslHelixd } from './wsl-helixd-deploy'
import { createWslHelixdHostTransport } from './wsl-helixd-host-transport'
import type { WslHelixdHostTarget } from './wsl-helixd-host-target'
import {
  decommissionWslHostHelixd,
  stopWslHostServer,
  wslHostRuntimeStopSteps,
  type WslHostRuntimeAccess
} from './wsl-host-server-stop'
import { createWslHelixdLivenessSupervisor } from './wsl-helixd-liveness-wiring'
import type { WslHelixdLivenessSupervisor } from './wsl-helixd-liveness-supervisor'
import { confirmsRunning } from './wsl-helixd-liveness-evidence'
import { wslDistroHolderKey } from './wsl-distro-holder-record'

function targetFor(distro: string): WslHelixdHostTarget {
  return { kind: 'wsl', id: defaultWslHelixdEnvironmentId(distro), distro, label: distro }
}

function transportFor(distro: string) {
  return createWslHelixdHostTransport({ target: targetFor(distro) })
}

type Reachability = WslHostReachability

export function createWslHostConnector(options: {
  userDataPath: string
  onChange: NonNullable<WslHelixdConnectionDependencies['onChange']>
  hasUserVisibleWork: (distro: string) => boolean
  /** False once a distro's host is gone: nothing may be spawned for it again. */
  isKnownDistro: (distro: string) => boolean
  runtime: WslHostRuntimeAccess
}): WslHostConnector {
  const refuseUnknown = (distro: string): Error =>
    new Error(`${distro} is no longer a WSL host; Helix will not start anything for it.`)
  // Assigned below; a holder exit cannot arrive before the first ensure.
  let supervisor: WslHelixdLivenessSupervisor | null = null
  const unguardedHolder = createWslDistroHolder({
    userDataPath: options.userDataPath,
    onHolderExit: (distro, exit) => supervisor?.noteHolderExit(distro, exit)
  })
  // Guard here because liveness recovery and deploy can bypass the service.
  const holder: WslDistroHolder = {
    ...unguardedHolder,
    ensureHeld: (distro) =>
      options.isKnownDistro(distro)
        ? unguardedHolder.ensureHeld(distro)
        : Promise.reject(refuseUnknown(distro))
  }
  const pairingRecovery = createWslHelixdPairingRecovery(options.userDataPath)
  const manager = new WslHelixdConnectionManager({
    holder,
    pairingRecovery,
    getPairingOffer: (environmentId) =>
      findWslHostDeployment(options.userDataPath, environmentId)
        ? resolveEnvironmentPairingOffer(options.userDataPath, environmentId)
        : null,
    recordedLocalPort: (environmentId) =>
      findWslHostDeployment(options.userDataPath, environmentId)?.localPort ?? null,
    onChange: options.onChange,
    deployAndLaunch: (distro, deployOptions) =>
      options.isKnownDistro(distro)
        ? deployAndLaunchWslHelixd(distro, deployOptions)
        : Promise.reject(refuseUnknown(distro))
  })
  const liveness = createWslHelixdLivenessSupervisor({
    manager,
    holder,
    hasUserVisibleWork: options.hasUserVisibleWork
  })
  supervisor = liveness
  // Read right before a no-boot reconnect spawns anything in the distro (E9).
  const requireRunning = async (distro: string): Promise<boolean> =>
    confirmsRunning(await readConfirmedRunningWslDistros(), wslDistroHolderKey(distro))
  const coldProbes = new Map<
    string,
    {
      connection: WslHelixdConnection | null
      pairingOffer: string | undefined
      result: Promise<Reachability>
    }
  >()
  const probe = async (
    distro: string,
    environmentId: string,
    connection: WslHelixdConnection | null
  ): Promise<Reachability> => {
    // Bridge dialing spawns wsl.exe; passive checks must first prove the distro runs.
    const running = await readConfirmedRunningWslDistros()
    if (running.status === 'unavailable') {
      return 'unavailable'
    }
    if (!confirmsRunning(running, wslDistroHolderKey(distro))) {
      return 'stopped'
    }
    if (!options.isKnownDistro(distro) || manager.get(distro) !== connection) {
      return 'unreachable'
    }
    if (options.runtime.isReady?.(environmentId)) {
      return 'available'
    }
    if (!connection) {
      return 'unreachable'
    }
    const offer = parsePairingCode(connection.pairingOffer)
    if (!offer) {
      return 'unreachable'
    }
    const identity = await verifyHelixdPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
      runtimeId: null
    })
    return identity.verdict === 'verified' && manager.get(distro) === connection
      ? 'available'
      : 'unreachable'
  }
  const coldReachability = (distro: string, environmentId: string): Promise<Reachability> => {
    const key = `${wslDistroHolderKey(distro)}\0${environmentId}`
    const connection = manager.get(distro)
    const pairingOffer = connection?.pairingOffer
    const pending = coldProbes.get(key)
    if (pending && pending.connection === connection && pending.pairingOffer === pairingOffer) {
      return pending.result
    }
    const result = probe(distro, environmentId, connection).finally(() => {
      if (coldProbes.get(key)?.result === result) {
        coldProbes.delete(key)
      }
    })
    coldProbes.set(key, { connection, pairingOffer, result })
    return result
  }
  return {
    listDistros: () => listWslHostDistros(),
    readHelixdPublicKey: (distro) => readWslDistroHelixdPublicKey(transportFor(distro)),
    connect: (distro, { noBoot, ...connectOptions } = {}) =>
      liveness.connect(distro, noBoot ? { ...connectOptions, requireRunning } : connectOptions),
    forgetPairingFailures: (environmentId) => pairingRecovery.repairs.forgetFailures(environmentId),
    get: (distro) => manager.get(distro),
    isReachable: async (distro, environmentId) =>
      options.runtime.isReady?.(environmentId) ||
      (await coldReachability(distro, environmentId)) === 'available',
    isSettling: (distro) => liveness.isSettling(distro),
    reachability: async (distro, environmentId) =>
      options.runtime.isReady?.(environmentId)
        ? 'available'
        : coldReachability(distro, environmentId),
    disconnect: (distro) => liveness.stop(distro),
    stopServer: async (distro, environmentId) => {
      const reachability = await coldReachability(distro, environmentId)
      if (reachability === 'unavailable') {
        return {
          stopped: false,
          reason: 'The WSL service did not confirm whether the distro runs.'
        }
      }
      if (reachability === 'stopped') {
        return { stopped: true }
      }
      if (reachability === 'unreachable') {
        await liveness.connect(distro)
      }
      const target = targetFor(distro)
      return stopWslHostServer({
        ...wslHostRuntimeStopSteps(options.runtime, environmentId),
        closeBridge: () => liveness.stop(distro),
        decommission: decommissionWslHostHelixd(target, createWslHelixdHostTransport({ target }))
      })
    },
    releaseHolder: async (distro) => {
      await holder.release(distro)
    },
    adoptHolders: async () => {
      await holder.adoptHolders()
    },
    dispose: () => liveness.dispose()
  }
}
