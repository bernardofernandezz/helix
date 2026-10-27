// Open forwards prove no identity; require an authenticated status call from the pinned server.
import { parsePairingCode } from '../../../shared/pairing'
import {
  pairedRuntimeConnectionFromOffer,
  type PairedRuntimeConnection
} from '../../../shared/paired-runtime-connection'
import { HELIXD_MANAGED_REMOTE_PORT } from '../../../shared/helixd-managed-runtime'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../shared/remote-runtime/remote-runtime-client-error-classification'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime-client-error'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { verifyRuntimePairingIdentity } from '../../runtime/runtime-environment-identity-verification'
import type { ServeReadiness } from '../../server/serve-readiness'
import { helixdBoundPort } from './helixd-managed-bound-port'
import { tunneledHelixdPairingCode } from '../../ssh/helixd-tunneled-pairing'

/** Unreachable proves no identity; unpaired is a refusal sealed by the pinned server key. */
export type HelixdTunnelIdentity =
  | { verdict: 'verified' }
  | { verdict: 'foreign' | 'unreachable' | 'unpaired'; detail: string }

export const HELIXD_IDENTITY_MISMATCH_CODE = 'helixd_identity_mismatch'

export class HelixdManagedIdentityError extends Error {
  readonly code = HELIXD_IDENTITY_MISMATCH_CODE
  constructor(remotePort: number, detail: string) {
    super(
      `${HELIXD_IDENTITY_MISMATCH_CODE}: the server on remote port ${remotePort} is not this ` +
        `host’s Helix server (another Helix may be using that port): ${detail}`
    )
    this.name = 'HelixdManagedIdentityError'
  }
}

export const HELIXD_PAIRING_REJECTED_CODE = 'helixd_pairing_rejected'

export class HelixdManagedPairingRejectedError extends Error {
  readonly code = HELIXD_PAIRING_REJECTED_CODE
  constructor(detail: string) {
    super(
      `${HELIXD_PAIRING_REJECTED_CODE}: this host’s Helix server no longer accepts ` +
        `this desktop's pairing (its saved devices were reset, or this desktop was removed ` +
        `there), so reconnecting alone won't restore access: ${detail}`
    )
    this.name = 'HelixdManagedPairingRejectedError'
  }
}

export function helixdIdentityRefusal(
  remotePort: number,
  identity: Exclude<HelixdTunnelIdentity, { verdict: 'verified' }>
): Error {
  return identity.verdict === 'unpaired'
    ? new HelixdManagedPairingRejectedError(identity.detail)
    : new HelixdManagedIdentityError(remotePort, identity.detail)
}

// Key rejection closes the socket instead of returning a status reply.
const FOREIGN_CLOSE_CODES = new Set([4001, 4003])

export function classifyHelixdTunnelIdentityFailure(error: unknown): HelixdTunnelIdentity {
  const detail = error instanceof Error ? error.message : String(error)
  // Only sealed access-grant refusals prove the pinned server answered.
  if (
    error instanceof RemoteRuntimeClientError &&
    error.code === 'unauthorized' &&
    error.pairingStage === 'access-grant'
  ) {
    return { verdict: 'unpaired', detail }
  }
  if (error instanceof RemoteRuntimeClientError && FOREIGN_CLOSE_CODES.has(error.closeCode ?? 0)) {
    return { verdict: 'foreign', detail }
  }
  return isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))
    ? { verdict: 'unreachable', detail }
    : { verdict: 'foreign', detail }
}

export async function verifyHelixdPairingIdentity(
  connection: PairedRuntimeConnection,
  expected: Pick<KnownRuntimeEnvironment, 'runtimeId' | 'pairedDeviceId'>
): Promise<HelixdTunnelIdentity> {
  try {
    await verifyRuntimePairingIdentity(connection, expected)
    return { verdict: 'verified' }
  } catch (error) {
    return classifyHelixdTunnelIdentityFailure(error)
  }
}

export function verifyManagedHelixdTunnelIdentity(
  environment: KnownRuntimeEnvironment
): Promise<HelixdTunnelIdentity> {
  if (!environment.helixdDeployment) {
    return Promise.resolve({ verdict: 'verified' })
  }
  // Runtime/device IDs can change or become stale; pinned-key handshake and token acceptance prove identity.
  return verifyHelixdPairingIdentity(getPreferredPairedRuntimeConnection(environment), {
    runtimeId: null
  })
}

/** Fresh deploys have no saved pairing; reread readiness after foreign answers to follow port changes. */
export function deployedHelixdTunnelChecks(
  initial: ServeReadiness,
  rereadReadiness: () => Promise<ServeReadiness>
) {
  let readiness = initial
  return {
    readiness: () => readiness,
    remotePort: helixdBoundPort(initial) ?? HELIXD_MANAGED_REMOTE_PORT,
    rereadRemotePort: async () => {
      readiness = await rereadReadiness()
      return helixdBoundPort(readiness) ?? HELIXD_MANAGED_REMOTE_PORT
    },
    verify: async (localPort: number): Promise<HelixdTunnelIdentity> => {
      const pairing = parsePairingCode(tunneledHelixdPairingCode(readiness, localPort))
      return pairing
        ? verifyHelixdPairingIdentity(pairedRuntimeConnectionFromOffer(pairing), {
            runtimeId: readiness.runtimeId || null
          })
        : { verdict: 'foreign', detail: 'This host’s Helix server published an invalid pairing.' }
    }
  }
}
