import { helixSessionAddressSql } from '../helix-session-address-sql'
import type { HelixSessionId } from '../../../../../shared/helix-session-address'
import type { RunRow } from '../../types'

type RunCoordinatorHelixSessionFields = Pick<
  RunRow,
  'coordinator_helix_session_id' | 'coordinator_helix_session_id_generation' | 'consumer_generation'
>

/** Count a coordinator session id only at its stamped consumer generation; older writers bump generation without clearing it. */
export function currentRunCoordinatorHelixSessionId(
  run: RunCoordinatorHelixSessionFields
): HelixSessionId | null {
  return run.coordinator_helix_session_id_generation === run.consumer_generation
    ? run.coordinator_helix_session_id
    : null
}

/** The same rule in SQL, for a `runs` row named `row` (a table name, alias, or `NEW`). */
export function currentRunCoordinatorHelixSessionIdSql(row: string): string {
  return `(CASE WHEN ${row}.coordinator_helix_session_id_generation = ${row}.consumer_generation
    THEN ${row}.coordinator_helix_session_id END)`
}

/** The coordinator's `helix_session_id:<id>` address in SQL; NULL when it has no current Helix session id. */
export function currentRunCoordinatorSessionAddressSql(row: string): string {
  return helixSessionAddressSql(currentRunCoordinatorHelixSessionIdSql(row))
}
