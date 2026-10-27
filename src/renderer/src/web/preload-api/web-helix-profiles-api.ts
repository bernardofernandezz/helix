import type { PreloadApi } from '../../../../preload/api-types'
import {
  DEFAULT_LOCAL_HELIX_PROFILE_ID,
  createDefaultLocalHelixProfile
} from '../../../../shared/helix-profiles'
import { noopUnsubscribe } from './web-storage'

export function createWebHelixProfilesApi(): Partial<PreloadApi> {
  const webHelixProfileAuthStatus = () =>
    Promise.resolve({
      activeProfileId: DEFAULT_LOCAL_HELIX_PROFILE_ID,
      configured: false,
      state: 'unconfigured' as const,
      persistence: 'none' as const,
      setupMessage: 'Helix Cloud sign-in is not available in the browser fallback.'
    })
  return {
    helixProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_HELIX_PROFILE_ID,
          profiles: [createDefaultLocalHelixProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webHelixProfileAuthStatus,
      onAuthStatusChanged: () => noopUnsubscribe,
      onSignInProgressChanged: () => noopUnsubscribe,
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_HELIX_PROFILE_ID,
          profiles: [createDefaultLocalHelixProfile(0)],
          profile: createDefaultLocalHelixProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webHelixProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webHelixProfileAuthStatus()
      }),
      signInProgress: async () => null,
      cancelSignIn: async () => {},
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webHelixProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webHelixProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_HELIX_PROFILE_ID,
        profiles: [createDefaultLocalHelixProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webHelixProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' })
    }
  }
}
