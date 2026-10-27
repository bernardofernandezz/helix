/** Only rollback-owned state: omit regenerable data and state owned by surviving processes. */
export const HELIXD_SNAPSHOT_MEMBERS = [
  'helix-profile-index.json',
  // Legacy layouts still supply migration input.
  'helix-data.json',
  'profiles',
  // Preserve cross-profile move recovery across server rollback.
  'profile-move-intents'
] as const

/** Live daemon ownership and regenerable logs must survive restore untouched. */
export const HELIXD_SNAPSHOT_EXCLUDED = ['daemon', 'logs'] as const

export const HELIXD_STATE_RESTORE_STAGE_DIRNAME = '.helixd-state-restore-stage'

export const HELIXD_STATE_MUTATION_LOCK_DIRNAME = 'helixd-state-mutation.lock'

/** Live mutations outlast stale windows; refresh their activation fence until owner exit. */
export const HELIXD_STATE_MUTATION_FENCE_HEARTBEAT_SECONDS = 60
/** Require several missed beats before reclaiming an exited desktop's lock. */
export const HELIXD_EXITED_OWN_LOCK_QUIET_SECONDS =
  3 * HELIXD_STATE_MUTATION_FENCE_HEARTBEAT_SECONDS

export const HELIXD_STATE_MUTATION_BUSY = 'STATE_MUTATION_BUSY'
export const HELIXD_STATE_MUTATION_DEADLINE = 'STATE_MUTATION_DEADLINE'

/** Windows uses a directory snapshot instead of POSIX state.tar. */
export const HELIXD_WINDOWS_SNAPSHOT_STATE_DIRNAME = 'state'

export const HELIXD_SNAPSHOT_FAILURE = 'SNAPSHOT_FAILURE'
