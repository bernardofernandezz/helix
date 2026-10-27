/** Unknown failures, including older hosts without census support, stay unverifiable and never mean zero live terminals. */
import { HELIXD_TERMINAL_CENSUS_RUNTIME_CAPABILITY } from '../../shared/helixd-runtime-capabilities'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/electron-remote-runtime-client-capabilities'
import type { PairedRuntimeConnection } from '../../shared/paired-runtime-connection'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import {
  HELIXD_TERMINAL_CENSUS_METHOD,
  HelixdTerminalCensusSchema,
  type HelixdTerminalCensus,
  UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
} from '../../shared/helixd-terminal-census'
import { sendRemoteRuntimeRequestWithStatusPreflight } from '../../shared/remote-runtime-client'
import type { HelixdActivationRecord } from '../managed-server/activation/helixd-activation-record'
import { ensureHelixdManagedTunnel } from '../managed-server/lifecycle/helixd-managed-tunnel'
import { verifyHelixdManagedServing } from '../managed-server/lifecycle/helixd-managed-serving-verify'

export type HelixdTerminalCensusRequestOptions = {
  releaseFinishedAutomationTerminals?: boolean
  /** Close the server's terminal admission this long before counting; 0 reopens it. */
  closeAdmissionForMs?: number
}

/** Wake idle servers behind ensured tunnels; failed wake/tunnel stays unverifiable. */
export async function collectManagedTerminalCensus(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  record: HelixdActivationRecord,
  timeoutMs = 15_000,
  options: HelixdTerminalCensusRequestOptions = {}
): Promise<HelixdTerminalCensus> {
  if (!record.active) {
    return { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  }
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
  }
  try {
    // Use the tunnel's returned pairing; re-pairing may have retired the caller's token.
    const current = await ensureHelixdManagedTunnel(userDataPath, environment.id)
    // Wake before census, except for reopen: a stopped server has no admission to release.
    if (options.closeAdmissionForMs !== 0) {
      await verifyHelixdManagedServing(userDataPath, environment.id)
    }
    return await requestHelixdTerminalCensus(
      getPreferredPairedRuntimeConnection(current),
      activatedAt,
      timeoutMs,
      options
    )
  } catch {
    return UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
  }
}

export async function requestHelixdTerminalCensus(
  connection: PairedRuntimeConnection,
  activatedAt: number,
  timeoutMs = 15_000,
  options: HelixdTerminalCensusRequestOptions = {}
): Promise<HelixdTerminalCensus> {
  try {
    const response = await sendRemoteRuntimeRequestWithStatusPreflight<unknown>(
      connection,
      HELIXD_TERMINAL_CENSUS_METHOD,
      {
        activatedAt,
        ...(options.releaseFinishedAutomationTerminals
          ? { releaseFinishedAutomationTerminals: true }
          : {}),
        // Older servers safely omit both unsupported admission request and reply fields.
        ...(options.closeAdmissionForMs === undefined
          ? {}
          : { closeAdmissionForMs: options.closeAdmissionForMs })
      },
      timeoutMs,
      (status) => {
        if (
          !status.ok ||
          !status.result.capabilities?.includes(HELIXD_TERMINAL_CENSUS_RUNTIME_CAPABILITY)
        ) {
          throw new Error('This host’s Helix server does not report a terminal census.')
        }
      },
      undefined,
      ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
    )
    return response.ok
      ? HelixdTerminalCensusSchema.parse(response.result)
      : UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
  } catch {
    return UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
  }
}
