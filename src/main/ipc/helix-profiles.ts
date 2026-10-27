import { ipcMain, type WebContents } from 'electron'
import type { Store } from '../persistence'
import { relaunchApp, type AppRelaunchReason } from '../app-relaunch'
import { quitProcess } from '../startup/process-quit-request'
import type {
  CreateLocalHelixProfileArgs,
  CreateLocalHelixProfileResult,
  CreateCloudLinkedHelixProfileArgs,
  CreateCloudLinkedHelixProfileResult,
  FindHelixProfileProjectsByPathArgs,
  FindHelixProfileProjectsByPathResult,
  HelixProfileListResult,
  RefreshCurrentHelixProfileAuthResult,
  SwitchHelixProfileArgs,
  SwitchHelixProfileResult,
  TransferHelixProfileProjectArgs,
  TransferHelixProfileProjectResult,
  ConnectCurrentHelixProfileResult,
  HelixProfileAuthStatus,
  HelixCloudSignInProgress,
  SelectHelixProfileOrgArgs,
  SelectHelixProfileOrgResult,
  SignOutCurrentHelixProfileResult
} from '../../shared/helix-profiles'
import {
  createLocalHelixProfile,
  getHelixProfileListState,
  seedNewHelixProfileTelemetryConsent,
  setActiveHelixProfile
} from '../helix-profiles/profile-index-store'
import { getProfileUserDataPath } from '../helix-profiles/profile-storage-paths'
import { isMultiProfileUiEnabled } from '../helix-profiles/profile-ui-scope'
import { transferHelixProfileProject } from '../helix-profiles/profile-project-transfer'
import { transferActiveProfileProject } from '../helix-profiles/profile-active-transfer'
import { findHelixProfileProjectsByPath } from '../helix-profiles/profile-project-presence'
import {
  flushActiveProfileBeforeFileMutation,
  flushActiveProfileBeforeRelaunch
} from '../helix-profiles/profile-persistence-deadline'
import { normalizeExecutionHostId } from '../../shared/execution-host'
import {
  createCloudLinkedHelixProfile,
  connectCurrentHelixProfile,
  getCurrentHelixProfileAuthStatus,
  refreshCurrentHelixProfileAuth,
  selectCurrentHelixProfileOrg,
  signOutCurrentHelixProfile
} from '../helix-profiles/profile-cloud-service'
import { registerHelixProfileOrgMemberHandlers } from './helix-profile-org-members-handlers'
import { onHelixCloudSessionInvalidated } from '../helix-profiles/profile-cloud-session-invalidation'
import {
  broadcastHelixProfileAuthStatusChanged,
  broadcastHelixProfileSignInProgressChanged
} from './helix-profile-auth-status-broadcast'
import {
  cancelHelixCloudSignIn,
  getHelixCloudSignInProgress,
  onHelixCloudSignInProgressChanged
} from '../helix-profiles/profile-cloud-sign-in-progress'
import { profileIdFromArgs } from './helix-profile-id-arg'
import { transferProjectArgsFromUnknown } from './helix-profile-project-transfer-args'

type RegisterHelixProfileHandlersOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
  onAuthMutation?: () => void
  onBeforeSignOut?: () => void
  onAfterSignOut?: () => void
}

function findProjectsByPathArgsFromUnknown(args: unknown): FindHelixProfileProjectsByPathArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_helix_profile_project_path')
  }
  const candidate = args as FindHelixProfileProjectsByPathArgs
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path) {
    throw new Error('invalid_helix_profile_project_path')
  }
  let executionHostId: FindHelixProfileProjectsByPathArgs['executionHostId'] = null
  if (candidate.executionHostId !== null && candidate.executionHostId !== undefined) {
    if (typeof candidate.executionHostId !== 'string') {
      throw new Error('invalid_helix_profile_project_path')
    }
    executionHostId = normalizeExecutionHostId(candidate.executionHostId)
    if (!executionHostId) {
      throw new Error('invalid_helix_profile_project_path')
    }
  }
  return {
    path,
    connectionId:
      typeof candidate.connectionId === 'string' ? candidate.connectionId.trim() || null : null,
    executionHostId,
    excludeProfileId:
      typeof candidate.excludeProfileId === 'string'
        ? candidate.excludeProfileId.trim() || null
        : null
  }
}

function orgIdFromUnknown(args: unknown): string {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_helix_profile_org_selection')
  }
  const orgId = (args as SelectHelixProfileOrgArgs).orgId?.trim()
  if (!orgId) {
    throw new Error('invalid_helix_profile_org_selection')
  }
  return orgId
}

function createCloudLinkedProfileArgsFromUnknown(args: unknown): CreateCloudLinkedHelixProfileArgs {
  if (!args || typeof args !== 'object') {
    return {}
  }
  const candidate = args as CreateCloudLinkedHelixProfileArgs
  const orgId = typeof candidate.orgId === 'string' ? candidate.orgId.trim() : undefined
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : undefined
  return {
    ...(orgId ? { orgId } : {}),
    ...(name ? { name } : {})
  }
}

async function runBeforeProfileRelaunch(
  onBeforeRelaunch?: () => void | Promise<void>
): Promise<void> {
  try {
    await onBeforeRelaunch?.()
  } catch (error) {
    console.warn(
      '[helix-profiles] Pre-relaunch cleanup failed; continuing profile switch:',
      error instanceof Error ? error.name : typeof error
    )
  }
}

type ProfileRelaunchReason = Extract<AppRelaunchReason, `profile-${string}`>

function scheduleProfileRelaunch(reason: ProfileRelaunchReason, sender: WebContents): void {
  if (!sender.isDestroyed()) {
    sender.send('app:restart-committed')
  }
  setTimeout(() => {
    relaunchApp(reason)
    // Normal quit preserves renderer scrollback, PTY teardown, stats flush and final daemon checkpoints.
    quitProcess()
  }, 150)
}

export function registerHelixProfileHandlers(
  store: Store,
  options: RegisterHelixProfileHandlersOptions = {}
): void {
  ipcMain.handle('helixProfiles:list', (): HelixProfileListResult => ({
    ...getHelixProfileListState(),
    multiProfileUi: isMultiProfileUiEnabled()
  }))

  ipcMain.handle('helixProfiles:authStatus', (): HelixProfileAuthStatus =>
    getCurrentHelixProfileAuthStatus(getProfileUserDataPath())
  )

  // Push background invalidation; re-entering onAuthMutation would loop into the relay coordinator that just failed.
  onHelixCloudSessionInvalidated(broadcastHelixProfileAuthStatusChanged)
  onHelixCloudSignInProgressChanged(broadcastHelixProfileSignInProgressChanged)

  ipcMain.handle(
    'helixProfiles:createLocal',
    (_event, args?: CreateLocalHelixProfileArgs): CreateLocalHelixProfileResult => {
      const result = createLocalHelixProfile(args)
      seedNewHelixProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
      return result
    }
  )

  ipcMain.handle(
    'helixProfiles:switch',
    async (event, args: SwitchHelixProfileArgs): Promise<SwitchHelixProfileResult> => {
      const profileId = profileIdFromArgs(args)
      const current = getHelixProfileListState()
      if (profileId === current.activeProfileId) {
        return { status: 'already-active' }
      }

      // Flush the source profile before switching the startup index; keep its writer alive through relaunch cleanup.
      await flushActiveProfileBeforeRelaunch(store)
      setActiveHelixProfile(profileId)
      await runBeforeProfileRelaunch(options.onBeforeRelaunch)

      scheduleProfileRelaunch('profile-switch', event.sender)

      return { status: 'relaunching' }
    }
  )

  ipcMain.handle(
    'helixProfiles:transferProject',
    async (
      event,
      rawArgs: TransferHelixProfileProjectArgs
    ): Promise<TransferHelixProfileProjectResult> => {
      const args = transferProjectArgsFromUnknown(rawArgs)
      const current = getHelixProfileListState()
      if (args.targetProfileId === current.activeProfileId) {
        throw new Error('active_target_helix_profile_transfer_requires_relaunch')
      }
      if (args.mode === 'move' && args.sourceProfileId === current.activeProfileId) {
        // Finish transfer before relaunch side effects so validation failure cannot strand the app quitting.
        const result = await transferActiveProfileProject(
          args,
          getProfileUserDataPath(),
          store,
          async () => {
            await runBeforeProfileRelaunch(options.onBeforeRelaunch)
            scheduleProfileRelaunch('profile-transfer', event.sender)
          }
        )
        if (result.status === 'transferred') {
          await runBeforeProfileRelaunch(options.onBeforeRelaunch)
          try {
            setActiveHelixProfile(args.targetProfileId)
          } finally {
            // The source has already changed and its writer cannot resume.
            scheduleProfileRelaunch('profile-transfer', event.sender)
          }
          return { ...result, willRelaunch: true }
        }
        return result
      }
      if (args.sourceProfileId !== current.activeProfileId) {
        await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
        return transferHelixProfileProject(args, getProfileUserDataPath())
      }
      const maintenance = await flushActiveProfileBeforeFileMutation(store)
      try {
        return transferHelixProfileProject(args, getProfileUserDataPath())
      } finally {
        await maintenance.resume()
      }
    }
  )

  ipcMain.handle(
    'helixProfiles:findProjectProfiles',
    (_event, rawArgs: FindHelixProfileProjectsByPathArgs): FindHelixProfileProjectsByPathResult =>
      findHelixProfileProjectsByPath(
        findProjectsByPathArgsFromUnknown(rawArgs),
        getProfileUserDataPath()
      )
  )

  ipcMain.handle(
    'helixProfiles:connectCurrent',
    async (): Promise<ConnectCurrentHelixProfileResult> => {
      const result = await connectCurrentHelixProfile(getProfileUserDataPath())
      if (result.status === 'connected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle('helixProfiles:signInProgress', (): HelixCloudSignInProgress | null =>
    getHelixCloudSignInProgress()
  )

  ipcMain.handle('helixProfiles:cancelSignIn', (): void => cancelHelixCloudSignIn())

  ipcMain.handle(
    'helixProfiles:createCloudLinked',
    async (
      _event,
      rawArgs?: CreateCloudLinkedHelixProfileArgs
    ): Promise<CreateCloudLinkedHelixProfileResult> => {
      const result = await createCloudLinkedHelixProfile(
        getProfileUserDataPath(),
        createCloudLinkedProfileArgsFromUnknown(rawArgs)
      )
      if (result.status === 'created') {
        seedNewHelixProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'helixProfiles:refreshAuth',
    async (): Promise<RefreshCurrentHelixProfileAuthResult> => {
      const result = await refreshCurrentHelixProfileAuth(getProfileUserDataPath())
      if (result.status === 'refreshed') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'helixProfiles:signOutCurrent',
    async (): Promise<SignOutCurrentHelixProfileResult> => {
      options.onBeforeSignOut?.()
      return signOutCurrentHelixProfile(getProfileUserDataPath()).finally(options.onAfterSignOut)
    }
  )

  ipcMain.handle(
    'helixProfiles:selectOrg',
    async (_event, rawArgs: SelectHelixProfileOrgArgs): Promise<SelectHelixProfileOrgResult> => {
      const result = await selectCurrentHelixProfileOrg(
        getProfileUserDataPath(),
        orgIdFromUnknown(rawArgs)
      )
      if (result.status === 'selected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  registerHelixProfileOrgMemberHandlers()
}
