/** C7 supplies visible demand; these production probes serve the WSL liveness supervisor. */
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode } from '../../shared/pairing'
import {
  type HelixdTerminalCensus,
  UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
} from '../../shared/helixd-terminal-census'
import { requestHelixdTerminalCensus } from '../ssh/helixd-terminal-census-client'
import { subscribeSystemPowerLifecycle } from '../system-power-lifecycle'
import {
  deferUntilWslDistroRunning,
  readConfirmedRunningWslDistros
} from '../wsl-background-distro-gate'
import type { WslDistroHolder } from './wsl-distro-holder'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import { readWslGuestIdentity } from './wsl-guest-process-identity'
import type { WslHelixdConnection, WslHelixdConnectionManager } from './wsl-helixd-connection'
import { defaultWslHelixdEnvironmentId } from './wsl-helixd-deploy'
import { confirmsRunning } from './wsl-helixd-liveness-evidence'
import { WslHelixdLivenessSupervisor } from './wsl-helixd-liveness-supervisor'
import { createWslHelixdHostTransport } from './wsl-helixd-host-transport'
import { openWslHelixdWatch } from './wsl-helixd-watch'

function transportFor(distro: string, environmentId = defaultWslHelixdEnvironmentId(distro)) {
  return createWslHelixdHostTransport({
    target: { kind: 'wsl', id: environmentId, distro, label: distro }
  })
}

/** Every session counts (activation time 0): liveness asks how many survived, not how new. */
function collectWslHelixdCensus(connection: WslHelixdConnection): Promise<HelixdTerminalCensus> {
  const offer = parsePairingCode(connection.pairingOffer)
  return offer
    ? requestHelixdTerminalCensus(pairedRuntimeConnectionFromOffer(offer), 0)
    : Promise.resolve(UNVERIFIABLE_HELIXD_TERMINAL_CENSUS)
}

export function createWslHelixdLivenessSupervisor(options: {
  manager: WslHelixdConnectionManager
  holder: WslDistroHolder
  hasUserVisibleWork: (distro: string) => boolean
}): WslHelixdLivenessSupervisor {
  return new WslHelixdLivenessSupervisor({
    manager: options.manager,
    readRunning: readConfirmedRunningWslDistros,
    readIdentity: (distro, helixdPid) => readWslGuestIdentity(transportFor(distro), helixdPid),
    openWatch: (connection) =>
      openWslHelixdWatch(
        transportFor(connection.distro, connection.environmentId),
        connection.remotePort
      ),
    collectCensus: collectWslHelixdCensus,
    hasUserVisibleWork: options.hasUserVisibleWork,
    deferUntilRunning: deferUntilWslDistroRunning,
    requireRunning: async (distro) =>
      confirmsRunning(await readConfirmedRunningWslDistros(), wslDistroHolderKey(distro)),
    ensureHolder: (distro) => options.holder.ensureHeld(distro),
    subscribePower: subscribeSystemPowerLifecycle
  })
}
