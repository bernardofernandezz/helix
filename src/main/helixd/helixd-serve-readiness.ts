import type { ServeReadiness } from '../server/serve-readiness'
import type { HelixRuntimeRpcServer } from '../runtime/runtime-rpc'
import { buildServePairingReadiness } from '../server/serve-pairing-readiness'
import type { HelixdHealth } from './helixd-health'
import type { HelixdOptions } from './helixd-start-contract'

export async function buildHelixdServeReadiness(input: {
  options: HelixdOptions
  runtimeId: string
  rpc: Pick<HelixRuntimeRpcServer, 'getWebSocketEndpoint' | 'createPairingOffer'>
  collectHealth: () => Promise<HelixdHealth>
}): Promise<ServeReadiness> {
  return {
    runtimeId: input.runtimeId,
    ...(await buildServePairingReadiness(input.options, input.rpc)),
    // WSL CLI reconciliation runs only in desktop launch, so no repair is pending here.
    managedWslCliReconciliation: 'settled',
    // Deployers inspect readiness health to reject hosts whose terminal daemon is unavailable.
    health: await input.collectHealth()
  }
}
