import type { PairingOffer } from '../../shared/pairing'
import type { HelixdTunnelIdentity } from '../managed-server/lifecycle/helixd-managed-tunnel-identity'
import type { ServeReadiness } from '../server/serve-readiness'
import type { HelixdHostTransport } from '../ssh/helixd-host-transport'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import type { WslDistroHolder } from './wsl-distro-holder'
import type { WslHelixdConnectionStatus } from './wsl-helixd-connection-status'
import type {
  WslHelixdDeferredUpdate,
  WslHelixdDeployOptions,
  WslHelixdLaunch
} from './wsl-helixd-deploy'
import type { WslHelixdHostTarget } from './wsl-helixd-host-target'
import type { WslHelixdPairingRecovery } from './wsl-helixd-pairing-identity'
import type { WslHelixdStdioBridgeOptions } from './wsl-helixd-stdio-bridge'

/** One open bridge to a distro's helixd, as the connection manager publishes it. */
export type WslHelixdConnection = {
  distro: string
  environmentId: string
  /** The loopback port on this machine the pairing offer points at. */
  localPort: number
  /** helixd's port inside the distro. */
  remotePort: number
  fullVersion: string
  /** helixd's pid inside the distro, from its pid file; null when unreadable. */
  pid: number | null
  /** helixd's pairing code, with its endpoint rewritten to `ws://127.0.0.1:<localPort>`. */
  pairingOffer: string
  /** An app update the incumbent `fullVersion` is waiting to take (live terminals). */
  deferredUpdate: WslHelixdDeferredUpdate | null
  close(): Promise<void>
}

export type WslHelixdConnectionDependencies = {
  holder?: WslDistroHolder
  getPairingOffer?: (environmentId: string) => PairingOffer | null
  /** The bridge port the host's record saved: rebinding it keeps the pairing across app restarts. */
  recordedLocalPort?: (environmentId: string) => number | null
  deployAndLaunch?: (distro: string, options: WslHelixdDeployOptions) => Promise<WslHelixdLaunch>
  createTransport?: (target: WslHelixdHostTarget) => HelixdHostTransport
  listen?: (
    transport: HelixdHostTransport,
    options: WslHelixdStdioBridgeOptions
  ) => Promise<StartedPortForward>
  verifyIdentity?: (
    pairingOffer: string,
    readiness: ServeReadiness
  ) => Promise<HelixdTunnelIdentity>
  /** Re-pairs a refused enrolled token; without it a refusal fails the connect. */
  pairingRecovery?: Omit<WslHelixdPairingRecovery, 'environmentId'>
  /** A connection (re)opened, its offer changed, or its status moved; null once it closed. */
  onChange?: (
    distro: string,
    connection: WslHelixdConnection | null,
    status: WslHelixdConnectionStatus
  ) => void
}
