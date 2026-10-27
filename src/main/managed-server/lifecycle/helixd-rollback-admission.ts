import type { HelixdTerminalCensus } from '../../../shared/helixd-terminal-census'
import type { HelixdRollbackResult } from '../install/helixd-remote-rollback'

export function rollbackRecountRefusal(census: HelixdTerminalCensus): HelixdRollbackResult | null {
  const live = census.liveSessions
  if (live === 0) {
    return null
  }
  return {
    outcome: 'refused',
    code:
      live === null ? 'helixd_rollback_census_unavailable' : 'helixd_rollback_terminals_running',
    reason:
      live === null
        ? 'The server did not answer how many terminals it runs. Retry when it answers.'
        : 'A terminal opened on this server before it could be stopped; close it, then retry.'
  }
}

export const ROLLBACK_STALE_COUNT: HelixdRollbackResult = {
  outcome: 'refused',
  code: 'helixd_rollback_census_unavailable',
  reason: 'The terminal count went stale before the server could be stopped. Retry the rollback.'
}
