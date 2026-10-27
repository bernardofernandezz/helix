import { createProfileStateStoreForStartup } from '../persistence/profile-state/profile-state-startup-authority'
import type { ProfileStateStoreFactoryResult } from '../persistence/profile-state/profile-state-store-factory'
import {
  ensureActiveHelixProfile,
  initHelixProfilePaths
} from '../helix-profiles/profile-index-store'
import { initSshHostKeyStoreFile } from '../ssh/ssh-host-key-store'
import { initHelixdHeldFenceTokenFile } from '../ssh/helixd-held-fence-tokens'
import { emitHelixdProfileStateAuthoritySelected } from './helixd-profile-state-telemetry'

type HelixdProfileStateStartup = {
  store: ProfileStateStoreFactoryResult['store']
  authority: {
    backend: ProfileStateStoreFactoryResult['backend']
    classification: ProfileStateStoreFactoryResult['classification']
    authority_mode: 'sqlite-established'
    runtime: 'helixd'
    migrated: boolean
  }
}

export async function createHelixdProfileStateStartup(
  userDataPath: string
): Promise<HelixdProfileStateStartup> {
  initHelixProfilePaths()
  const profile = ensureActiveHelixProfile(userDataPath)
  // Real persistence avoids falsely empty RPCs; headless authority keeps automations owned by this host.
  const result = await createProfileStateStoreForStartup({
    userDataPath,
    dataFile: profile.dataFile,
    databaseFile: profile.stateDatabaseFile,
    profileId: profile.profile.id,
    runtime: 'helixd',
    storageAuthority: 'runtime'
  })
  const authority = {
    backend: result.backend,
    classification: result.classification,
    authority_mode: 'sqlite-established' as const,
    runtime: 'helixd' as const,
    migrated: result.migrated
  }
  try {
    initSshHostKeyStoreFile(profile.dataFile)
    initHelixdHeldFenceTokenFile(profile.dataFile)
    emitHelixdProfileStateAuthoritySelected(authority)
    return { store: result.store, authority }
  } catch (error) {
    try {
      await result.store.freezeWritesAsync()
    } catch (closeError) {
      console.error(
        '[persistence] Failed to close profile persistence after startup failure:',
        closeError
      )
    }
    throw error
  }
}
