import type { AutomationStorageAuthority } from '../scheduling-automations/automation-owner-projection'
import { isProfileStateSqliteAvailable } from './profile-state-database'
import type {
  ProfileStateStoreFactoryOptions,
  ProfileStateStoreFactoryResult
} from './profile-state-store-factory'
import { createLiveProfileStateStore } from './profile-state-live-store-factory'

export type ProfileStateStartupRuntime = 'desktop' | 'helixd'

export type ProfileStateStartupAuthorityOptions = Omit<
  ProfileStateStoreFactoryOptions,
  'storageAuthority'
> & {
  runtime: ProfileStateStartupRuntime
  storageAuthority: AutomationStorageAuthority
  onPersistenceFailure?: (error: Error) => void
  onPersistenceSaveDelayChanged?: (delayed: boolean) => void
}

export class ProfileStateStartupAuthorityError extends Error {
  readonly code = 'helixd-sqlite-authority-unsupported' as const

  constructor() {
    super(
      'helixd requires SQLite database and backup support. Launch it through its pinned Node runtime.'
    )
    this.name = 'ProfileStateStartupAuthorityError'
  }
}

/** Desktop and helixd share the validated authority boundary. */
export async function createProfileStateStoreForStartup(
  options: ProfileStateStartupAuthorityOptions
): Promise<ProfileStateStoreFactoryResult> {
  if (options.runtime === 'helixd' && !isProfileStateSqliteAvailable()) {
    throw new ProfileStateStartupAuthorityError()
  }
  return createLiveProfileStateStore(options, {
    onSaveDelayChanged: options.onPersistenceSaveDelayChanged,
    onFailure:
      options.onPersistenceFailure ??
      ((error) =>
        console.error('[persistence] Saving has stopped. Restart Helix before continuing.', error))
  })
}
