import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import type { ServeReadiness } from '../server/serve-readiness'
import {
  helixdIdentityRefusal,
  verifyHelixdPairingIdentity,
  type HelixdTunnelIdentity
} from '../managed-server/lifecycle/helixd-managed-tunnel-identity'
import { tunneledHelixdPairingCode } from '../ssh/helixd-tunneled-pairing'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import {
  buildWithPairingRepair,
  type ManagedHelixdPairingRecovery
} from '../managed-server/lifecycle/helixd-managed-tunnel-pairing-recovery'
import type { WslHelixdLaunch } from './wsl-helixd-deploy'

/** The managed repair gate a refused enrolled token goes through, for one WSL host. */
export type WslHelixdPairingRecovery = Omit<ManagedHelixdPairingRecovery, 'ensure'> & {
  environmentId: string
}

/** Reconnect with enrolled token/pinned host key. Repair refusal once through the gate and verify the replacement; startup offers are for enrollment only. */
export async function resolveWslHelixdPairing(
  launch: Extract<WslHelixdLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity = verifyWslHelixdIdentity,
  recovery?: WslHelixdPairingRecovery
): Promise<string> {
  const verified = (offer: PairingOffer | null) =>
    verifyWslHelixdPairing(launch, localPort, offer, verifyIdentity)
  // First-time pairing has no enrolled token to repair.
  if (!recovery || !paired) {
    return verified(paired)
  }
  let pairingOffer = ''
  await buildWithPairingRepair(
    {
      ...recovery,
      ensure: async (environment) => {
        pairingOffer = await verified(getPreferredPairingOffer(environment))
      }
    },
    recovery.environmentId,
    async () => {
      pairingOffer = await verified(paired)
    }
  )
  return pairingOffer
}

async function verifyWslHelixdPairing(
  launch: Extract<WslHelixdLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity: typeof verifyWslHelixdIdentity
): Promise<string> {
  const pairingOffer = tunneledHelixdPairingCode(launch.readiness, localPort, paired)
  const identity = await verifyIdentity(pairingOffer, launch.readiness)
  if (identity.verdict === 'foreign' || identity.verdict === 'unpaired') {
    throw helixdIdentityRefusal(launch.port, identity)
  }
  if (identity.verdict === 'unreachable') {
    console.warn(
      `[wsl] Helix server in ${launch.distro} did not answer its bridge: ${identity.detail}`
    )
  }
  return pairingOffer
}

/** Whether the server behind a WSL bridge is the helixd that published `readiness`. */
export async function verifyWslHelixdIdentity(
  pairingOffer: string,
  readiness: ServeReadiness
): Promise<HelixdTunnelIdentity> {
  const offer = parsePairingCode(pairingOffer)
  return offer
    ? verifyHelixdPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
        runtimeId: readiness.runtimeId || null
      })
    : { verdict: 'foreign', detail: 'The Helix server in WSL published an invalid pairing offer.' }
}
