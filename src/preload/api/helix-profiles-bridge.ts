import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import {
  HELIX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  HELIX_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type HelixCloudSignInProgress,
  type HelixProfileListResult,
  type SwitchHelixProfileResult,
  type TransferHelixProfileProjectResult
} from '../../shared/helix-profiles'
import { prepareAndInvokeAppRestart } from '../renderer-restart-wiring'
import { awaitBeforeUnloadCheckpoint } from '../preload-runtime-support'

export const helixProfilesApi = {
  list: () => ipcRenderer.invoke('helixProfiles:list'),
  authStatus: () => ipcRenderer.invoke('helixProfiles:authStatus'),
  onAuthStatusChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(HELIX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(HELIX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
  },
  onSignInProgressChanged: (
    callback: (progress: HelixCloudSignInProgress | null) => void
  ): (() => void) => {
    const listener = (_event: unknown, progress: HelixCloudSignInProgress | null): void =>
      callback(progress)
    ipcRenderer.on(HELIX_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
    return () =>
      ipcRenderer.removeListener(HELIX_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
  },
  createLocal: (args) => ipcRenderer.invoke('helixProfiles:createLocal', args),
  createCloudLinked: (args) => ipcRenderer.invoke('helixProfiles:createCloudLinked', args),
  switchProfile: (args) =>
    prepareAndInvokeAppRestart(
      window,
      (): Promise<SwitchHelixProfileResult> => ipcRenderer.invoke('helixProfiles:switch', args),
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'relaunching'
    ),
  transferProject: async (args) => {
    const invoke = (): Promise<TransferHelixProfileProjectResult> =>
      ipcRenderer.invoke('helixProfiles:transferProject', args)
    if (args.mode !== 'move') {
      return invoke()
    }
    const current: HelixProfileListResult = await ipcRenderer.invoke('helixProfiles:list')
    if (args.sourceProfileId !== current.activeProfileId) {
      return invoke()
    }
    return prepareAndInvokeAppRestart(
      window,
      invoke,
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'transferred' && result.willRelaunch === true
    )
  },
  findProjectProfiles: (args) => ipcRenderer.invoke('helixProfiles:findProjectProfiles', args),
  connectCurrent: () => ipcRenderer.invoke('helixProfiles:connectCurrent'),
  signInProgress: () => ipcRenderer.invoke('helixProfiles:signInProgress'),
  cancelSignIn: () => ipcRenderer.invoke('helixProfiles:cancelSignIn'),
  refreshAuth: () => ipcRenderer.invoke('helixProfiles:refreshAuth'),
  signOutCurrent: () => ipcRenderer.invoke('helixProfiles:signOutCurrent'),
  selectOrg: (args) => ipcRenderer.invoke('helixProfiles:selectOrg', args),
  orgMembersList: (args) => ipcRenderer.invoke('helixProfiles:orgMembersList', args),
  orgMemberInvite: (args) => ipcRenderer.invoke('helixProfiles:orgMemberInvite', args),
  orgInviteRevoke: (args) => ipcRenderer.invoke('helixProfiles:orgInviteRevoke', args),
  orgMemberChangeRole: (args) => ipcRenderer.invoke('helixProfiles:orgMemberChangeRole', args),
  orgMemberRemove: (args) => ipcRenderer.invoke('helixProfiles:orgMemberRemove', args)
} satisfies PreloadApi['helixProfiles']
