import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  HelixCloudSignInProgress,
  HelixProfileAuthStatus,
  HelixProfileSummary,
  SwitchHelixProfileResult,
  TransferHelixProfileProjectArgs,
  TransferHelixProfileProjectResult
} from '../../../../shared/helix-profiles'
import type { AppState } from '../types'
import {
  createHelixProfilesAuthActions,
  type HelixProfilesAuthActions
} from './helix-profiles-auth-actions'

export type HelixProfilesSlice = HelixProfilesAuthActions & {
  helixProfiles: HelixProfileSummary[]
  activeHelixProfileId: string | null
  helixProfileAuthStatus: HelixProfileAuthStatus | null
  helixProfileSignInProgress: HelixCloudSignInProgress | null
  helixProfilesMultiProfileUi: boolean
  helixProfilesLoading: boolean
  helixProfileSwitching: boolean
  fetchHelixProfiles: () => Promise<void>
  fetchHelixProfileAuthStatus: () => Promise<HelixProfileAuthStatus | null>
  createLocalHelixProfile: (name?: string) => Promise<HelixProfileSummary | null>
  switchHelixProfile: (profileId: string) => Promise<SwitchHelixProfileResult | null>
  transferHelixProfileProject: (
    args: TransferHelixProfileProjectArgs
  ) => Promise<TransferHelixProfileProjectResult | null>
}

export const createHelixProfilesSlice: StateCreator<AppState, [], [], HelixProfilesSlice> = (
  set,
  get,
  api
) => ({
  helixProfiles: [],
  activeHelixProfileId: null,
  helixProfileAuthStatus: null,
  helixProfileSignInProgress: null,
  helixProfilesMultiProfileUi: false,
  helixProfilesLoading: false,
  helixProfileSwitching: false,

  fetchHelixProfiles: async () => {
    set({ helixProfilesLoading: true })
    try {
      const [state, authStatus] = await Promise.all([
        window.api.helixProfiles.list(),
        window.api.helixProfiles.authStatus()
      ])
      set({
        activeHelixProfileId: state.activeProfileId,
        helixProfiles: state.profiles,
        helixProfilesMultiProfileUi: state.multiProfileUi,
        helixProfileAuthStatus: authStatus,
        helixProfilesLoading: false
      })
    } catch (err) {
      console.error('Failed to fetch Helix profiles:', err)
      set({ helixProfilesLoading: false })
    }
  },

  fetchHelixProfileAuthStatus: async () => {
    try {
      const authStatus = await window.api.helixProfiles.authStatus()
      set({ helixProfileAuthStatus: authStatus })
      return authStatus
    } catch (err) {
      console.error('Failed to fetch Helix profile auth status:', err)
      return null
    }
  },

  createLocalHelixProfile: async (name) => {
    try {
      const state = await window.api.helixProfiles.createLocal({ name })
      set({
        activeHelixProfileId: state.activeProfileId,
        helixProfiles: state.profiles
      })
      void get().fetchHelixProfileAuthStatus()
      return state.profile
    } catch (err) {
      console.error('Failed to create Helix profile:', err)
      toast.error(
        translate('auto.store.slices.helix.profiles.612f7f6861', 'Failed to create profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  ...createHelixProfilesAuthActions(set, get, api),

  switchHelixProfile: async (profileId) => {
    if (!profileId || profileId === get().activeHelixProfileId) {
      return { status: 'already-active' }
    }
    set({ helixProfileSwitching: true })
    try {
      const result = await window.api.helixProfiles.switchProfile({ profileId })
      if (result?.status !== 'relaunching') {
        // Only actual relaunch locks switcher; stale already-active answers must unlock it.
        set({ helixProfileSwitching: false })
      }
      return result
    } catch (err) {
      console.error('Failed to switch Helix profile:', err)
      set({ helixProfileSwitching: false })
      toast.error(
        translate('auto.store.slices.helix.profiles.7d4bc516ee', 'Failed to switch profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  transferHelixProfileProject: async (args) => {
    try {
      const result = await window.api.helixProfiles.transferProject(args)
      if (result.status === 'duplicate-target') {
        toast.error(
          translate(
            'auto.store.slices.helix.profiles.f518e89aa5',
            'Project already exists in that profile'
          )
        )
      }
      if (result.status === 'transferred' && result.willRelaunch) {
        set({ helixProfileSwitching: true })
      }
      return result
    } catch (err) {
      console.error('Failed to transfer Helix profile project:', err)
      toast.error(
        translate('auto.store.slices.helix.profiles.f03ae7f27b', 'Failed to transfer project'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  }
})
