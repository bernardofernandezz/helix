import { refreshManagedHelixdPairing } from '../../shared/runtime-environment-managed-helixd-store'
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import {
  getHelixdSshDeployment,
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import type { ServeReadiness } from '../server/serve-readiness'
import { tunneledHelixdPairingCode } from './helixd-tunneled-pairing'

/** Saves the pairing a managed server published after an update, rollback or restart. */
export function refreshMaintainedHelixdPairing(
  userDataPath: string,
  environmentId: string,
  readiness: ServeReadiness
): KnownRuntimeEnvironment {
  // Reuse the enrolled grant after restart so pairing cannot replace this desktop’s identity.
  // Re-read because census may have repaired pairing or moved the tunnel port meanwhile.
  const current = resolveEnvironment(userDataPath, environmentId)
  const localPort = getHelixdSshDeployment(current)?.localPort
  if (localPort === undefined) {
    throw new Error('This server is no longer managed over SSH.')
  }
  const enrolled = getPreferredPairingOffer(current)
  const pairingCode = tunneledHelixdPairingCode(readiness, localPort, enrolled)
  return refreshManagedHelixdPairing(userDataPath, environmentId, pairingCode)
}
