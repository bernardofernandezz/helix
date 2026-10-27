import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ConnectCurrentHelixProfileResult,
  CreateCloudLinkedHelixProfileResult,
  RefreshCurrentHelixProfileAuthResult,
  SelectHelixProfileOrgResult,
  SignOutCurrentHelixProfileResult
} from '../../../../shared/helix-profiles'
import type { AppState } from '../types'

export type HelixProfilesAuthActions = {
  createCloudLinkedHelixProfile: (args: {
    orgId?: string
    name?: string
  }) => Promise<CreateCloudLinkedHelixProfileResult | null>
  connectCurrentHelixProfile: () => Promise<ConnectCurrentHelixProfileResult | null>
  refreshCurrentHelixProfileAuth: () => Promise<RefreshCurrentHelixProfileAuthResult | null>
  signOutCurrentHelixProfile: () => Promise<SignOutCurrentHelixProfileResult | null>
  selectHelixProfileOrg: (orgId: string) => Promise<SelectHelixProfileOrgResult | null>
}

export const createHelixProfilesAuthActions: StateCreator<
  AppState,
  [],
  [],
  HelixProfilesAuthActions
> = (set, get) => {
  let nextConnectAttempt = 0
  let appliedConnectAttempt = 0

  return {
    createCloudLinkedHelixProfile: async (args) => {
      try {
        const result = await window.api.helixProfiles.createCloudLinked(args)
        set({
          helixProfileAuthStatus: result.auth,
          ...(result.status === 'created'
            ? {
                activeHelixProfileId: result.activeProfileId,
                helixProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'created') {
          toast.success(
            translate('auto.store.slices.helix.profiles.319d7cf39b', 'Cloud profile created')
          )
        } else if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.helix.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.helix.profiles.f0c9e11a6d',
              'Failed to create cloud profile'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to create Helix cloud profile:', err)
        toast.error(
          translate(
            'auto.store.slices.helix.profiles.f0c9e11a6d',
            'Failed to create cloud profile'
          ),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    connectCurrentHelixProfile: async () => {
      const attempt = ++nextConnectAttempt
      try {
        // Pending PKCE must not block retry; newer linked waits supersede older callbacks.
        const result = await window.api.helixProfiles.connectCurrent()
        if (attempt < appliedConnectAttempt) {
          return result
        }
        const alreadyConnected = get().helixProfileAuthStatus?.state === 'connected'
        set({
          helixProfileAuthStatus: result.auth,
          ...(result.status === 'connected'
            ? {
                activeHelixProfileId: result.activeProfileId,
                helixProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'connected') {
          appliedConnectAttempt = attempt
          if (!alreadyConnected) {
            toast.success(
              translate('auto.store.slices.helix.profiles.9fcb07a796', 'Profile connected')
            )
          }
        } else if (result.status === 'unconfigured') {
          toast.error(
            translate(
              'auto.store.slices.helix.profiles.8b8fa73174',
              'Helix Cloud sign-in is not configured'
            ),
            {
              description: result.auth.setupMessage
            }
          )
        } else if (result.status === 'timed-out' && !alreadyConnected) {
          toast.error(
            translate('auto.store.slices.helix.profiles.signInTimedOut', 'Sign-in timed out')
          )
        } else if (
          result.status === 'failed' &&
          !alreadyConnected &&
          result.auth.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.helix.profiles.33290e88ed', 'Failed to connect profile'),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to connect Helix profile:', err)
        if (
          attempt >= appliedConnectAttempt &&
          get().helixProfileAuthStatus?.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.helix.profiles.33290e88ed', 'Failed to connect profile'),
            {
              description: err instanceof Error ? err.message : String(err)
            }
          )
        }
        return null
      }
    },

    refreshCurrentHelixProfileAuth: async () => {
      try {
        const result = await window.api.helixProfiles.refreshAuth()
        set({
          helixProfileAuthStatus: result.auth,
          ...(result.status === 'refreshed'
            ? {
                activeHelixProfileId: result.activeProfileId,
                helixProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.helix.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.helix.profiles.2f6c78a039',
              'Failed to refresh profile auth'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to refresh Helix profile auth:', err)
        toast.error(
          translate(
            'auto.store.slices.helix.profiles.2f6c78a039',
            'Failed to refresh profile auth'
          ),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    signOutCurrentHelixProfile: async () => {
      nextConnectAttempt += 1
      appliedConnectAttempt = nextConnectAttempt
      try {
        const result = await window.api.helixProfiles.signOutCurrent()
        set({
          activeHelixProfileId: result.activeProfileId,
          helixProfiles: result.profiles,
          helixProfileAuthStatus: result.auth
        })
        if (result.auth.state !== 'connected') {
          toast.success(
            translate('auto.store.slices.helix.profiles.a37b5e6d37', 'Signed out of profile')
          )
        }
        return result
      } catch (err) {
        console.error('Failed to sign out of Helix profile:', err)
        toast.error(
          translate('auto.store.slices.helix.profiles.83600521e7', 'Failed to sign out'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    selectHelixProfileOrg: async (orgId) => {
      try {
        const result = await window.api.helixProfiles.selectOrg({ orgId })
        set({
          helixProfileAuthStatus: result.auth,
          ...(result.status === 'selected'
            ? {
                activeHelixProfileId: result.activeProfileId,
                helixProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.helix.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.helix.profiles.76deec8f58',
              'Failed to switch organization'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to switch Helix profile org:', err)
        toast.error(
          translate('auto.store.slices.helix.profiles.76deec8f58', 'Failed to switch organization'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    }
  }
}
