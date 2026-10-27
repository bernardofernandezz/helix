import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import type { HelixdManagedServing } from './helixd-managed-serving'
import { verifyManagedTunnelServing } from './helixd-managed-tunnel'

/** Return unverifiable on failures rather than throwing. */
export function verifyHelixdManagedServing(
  userDataPath: string,
  selector: string
): Promise<HelixdManagedServing> {
  return Promise.resolve()
    .then(() => verifyManagedTunnelServing(resolveEnvironment(userDataPath, selector)))
    .catch((error: unknown) => ({ state: 'unverifiable', detail: String(error) }))
}
