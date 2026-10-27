/** Daemons outlive helixd swaps; incoming builds can attach only current/previous daemon protocols, matching config/scripts/daemon-protocol-facts.mjs canAttach. */
import {
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION
} from '../daemon/daemon-protocol-version'
import type { HelixdTerminalCensus } from '../../shared/helixd-terminal-census'

export type HelixdDaemonProtocolFacts = {
  protocolVersion: number
  previousProtocolVersions: readonly number[]
}

export const CURRENT_HELIXD_DAEMON_PROTOCOL: HelixdDaemonProtocolFacts = {
  protocolVersion: PROTOCOL_VERSION,
  previousProtocolVersions: PREVIOUS_DAEMON_PROTOCOL_VERSIONS
}

export function helixdBuildCanAttachDaemon(
  reader: HelixdDaemonProtocolFacts,
  ownerProtocolVersion: number
): boolean {
  return (
    reader.protocolVersion === ownerProtocolVersion ||
    reader.previousProtocolVersions.includes(ownerProtocolVersion)
  )
}

export type HelixdLiveDaemonCrossing =
  | 'no-live-terminals'
  | 'attachable'
  | 'strands-live-terminals'
  | 'unverifiable'

/** An unknown session count or daemon protocol is planned for as live and unattachable. */
export function assessHelixdLiveDaemonCrossing(
  census: HelixdTerminalCensus,
  incoming: HelixdDaemonProtocolFacts
): HelixdLiveDaemonCrossing {
  if (census.liveSessions === 0) {
    return 'no-live-terminals'
  }
  if (census.daemonProtocolVersion === null) {
    return 'unverifiable'
  }
  return helixdBuildCanAttachDaemon(incoming, census.daemonProtocolVersion)
    ? 'attachable'
    : 'strands-live-terminals'
}
