// Lost channels drop their sockets but keep the listener; tunnel reconnect logic owns recovery.
import { HelixdStdioBridgeUnavailableError } from '../../helixd/helixd-host-unavailable'
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'
import {
  checkHelixdStdioBridge,
  openHelixdStdioBridgeChannel,
  resolveHelixdStdioBridge,
  type HelixdStdioBridge
} from '../../ssh/helixd-stdio-bridge'
import { listenHelixdStdioBridge } from './helixd-stdio-bridge-listener'
import { sshHelixdHostTransport } from '../../ssh/helixd-ssh-host-transport'
import type { RemoteCommandChannel } from '../install/remote-install-transport'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import type {
  PortForwardStartOptions,
  SshPortForwardProvider,
  StartedPortForward
} from '../../ssh/port-forwarding/ssh-port-forward-provider'

export type HelixdStdioBridgeDependencies = {
  resolveBridge: (conn: HelixdHostTransport, port: number) => Promise<HelixdStdioBridge>
  checkBridge: (conn: HelixdHostTransport, bridge: HelixdStdioBridge) => Promise<unknown>
  openChannel: (
    conn: HelixdHostTransport,
    bridge: HelixdStdioBridge
  ) => Promise<RemoteCommandChannel>
}

export const HELIXD_STDIO_BRIDGE_DEPENDENCIES: HelixdStdioBridgeDependencies = {
  resolveBridge: resolveHelixdStdioBridge,
  checkBridge: checkHelixdStdioBridge,
  openChannel: openHelixdStdioBridgeChannel
}

export class HelixdStdioBridgePortForwardProvider implements SshPortForwardProvider {
  constructor(
    private readonly dependencies: HelixdStdioBridgeDependencies = HELIXD_STDIO_BRIDGE_DEPENDENCIES
  ) {}

  canHandle(conn: SshConnection): boolean {
    return conn.getClient() !== null || conn.usesSystemSshTransport()
  }

  start(conn: SshConnection, options: PortForwardStartOptions): Promise<StartedPortForward> {
    return startHelixdStdioBridge(sshHelixdHostTransport(conn), options, this.dependencies)
  }
}

export async function startHelixdStdioBridge(
  host: HelixdHostTransport,
  options: PortForwardStartOptions,
  deps: HelixdStdioBridgeDependencies
): Promise<StartedPortForward> {
  let bridge: Promise<HelixdStdioBridge> | null = null
  // Retry failed bridge resolution on the next socket.
  const resolveBridge = (): Promise<HelixdStdioBridge> => {
    bridge ??= deps.resolveBridge(host, options.remotePort).catch((error: unknown) => {
      bridge = null
      throw error
    })
    return bridge
  }
  try {
    await deps.checkBridge(host, await resolveBridge())
  } catch (error) {
    if (error instanceof HelixdStdioBridgeUnavailableError) {
      throw error
    }
    // Lost contact does not prove bridge absence; let new sockets resolve it again.
    console.warn('[ssh] Helix stdio bridge check was unverifiable:', error)
  }
  return listenHelixdStdioBridge(options, async () => {
    const resolved = await resolveBridge()
    return { channel: await deps.openChannel(host, resolved), mode: resolved.mode }
  })
}
