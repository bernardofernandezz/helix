import type {
  ConnectCurrentHelixProfileResult,
  CreateCloudLinkedHelixProfileArgs,
  CreateCloudLinkedHelixProfileResult,
  HelixProfileAuthStatus,
  SelectHelixProfileOrgResult,
  SignOutCurrentHelixProfileResult
} from '../../shared/helix-profiles'
import { ensureActiveHelixProfile } from './profile-index-store'
import { getHelixCloudAuthConfig, isHelixCloudDevAuthEnabled } from './profile-cloud-auth-config'
import {
  invalidateCloudSessionChanges,
  readCloudSession,
  signInCloudSession,
  signOutCloudSession
} from './profile-cloud-session-owner'
import {
  createHelixCloudProfile,
  exchangeHelixCloudAuthCode,
  revokeHelixCloudSession
} from './profile-cloud-client'
import { beginHelixCloudPkceFlow } from './profile-cloud-pkce'
import {
  createCloudLinkedHelixProfileRecord,
  linkHelixProfileToCloud,
  unlinkHelixProfileFromCloud
} from './profile-cloud-index'
import { runWithFreshHelixCloudSession } from './profile-cloud-session-refresh'
import {
  connectDevHelixCloudProfile,
  createDevCloudLinkedHelixProfile,
  selectDevHelixCloudOrg
} from './profile-cloud-dev-service'
import { getHelixProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { selectCloudOrg } from './profile-cloud-org-selection'
import {
  endHelixCloudSignInProgress,
  setHelixCloudSignInLink,
  startHelixCloudSignInProgress
} from './profile-cloud-sign-in-progress'
import { clearRelayRegionPreferenceCache } from '../runtime/mobile-cloud-relay/relay-region-preference'

export { refreshCurrentHelixProfileAuth } from './profile-cloud-capability-refresh'

let nextCloudConnectAttempt = 0
let linkedCloudConnectAttempt = 0

function invalidateOutstandingCloudConnectAttempts(): void {
  nextCloudConnectAttempt += 1
  linkedCloudConnectAttempt = nextCloudConnectAttempt
  endHelixCloudSignInProgress()
}

function activeAuth(
  active: ReturnType<typeof ensureActiveHelixProfile>,
  userDataPath: string
): HelixProfileAuthStatus {
  return getHelixProfileAuthStatusFromProfile(active, userDataPath)
}

export function getCurrentHelixProfileAuthStatus(userDataPath: string): HelixProfileAuthStatus {
  return getHelixProfileAuthStatusFromProfile(ensureActiveHelixProfile(userDataPath), userDataPath)
}

export async function connectCurrentHelixProfile(
  userDataPath: string
): Promise<ConnectCurrentHelixProfileResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (isHelixCloudDevAuthEnabled()) {
    const list = connectDevHelixCloudProfile(active, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  }

  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: activeAuth(active, userDataPath)
    }
  }

  const attempt = ++nextCloudConnectAttempt
  const browserWait = new AbortController()
  startHelixCloudSignInProgress(attempt, () => browserWait.abort())
  try {
    const code = await beginHelixCloudPkceFlow(configState.config, active.profile.id, {
      signal: browserWait.signal,
      onAuthorizeUrl: (link) => setHelixCloudSignInLink(attempt, link)
    })
    // The callback listener has closed, so its browser link is dead.
    setHelixCloudSignInLink(attempt, null)
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentHelixProfileAuthStatus(userDataPath)
      }
    }
    const exchange = await exchangeHelixCloudAuthCode(configState.config, {
      ...code,
      localProfileId: active.profile.id
    })
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentHelixProfileAuthStatus(userDataPath)
      }
    }
    signInCloudSession(active.profile.id, userDataPath, exchange)
    const list = linkHelixProfileToCloud(active.profile.id, exchange.cloud, userDataPath)
    linkedCloudConnectAttempt = attempt
    return {
      status: 'connected',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'helix_cloud_auth_timeout' && attempt === nextCloudConnectAttempt) {
      return {
        status: 'timed-out',
        auth: getCurrentHelixProfileAuthStatus(userDataPath)
      }
    }
    if (
      message === 'helix_cloud_auth_timeout' ||
      message === 'helix_cloud_auth_denied' ||
      message === 'helix_cloud_auth_cancelled'
    ) {
      return {
        status: 'cancelled',
        auth: getCurrentHelixProfileAuthStatus(userDataPath)
      }
    }
    return {
      status: 'failed',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      error: message
    }
  } finally {
    endHelixCloudSignInProgress(attempt)
  }
}

export async function signOutCurrentHelixProfile(
  userDataPath: string
): Promise<SignOutCurrentHelixProfileResult> {
  // Pending browser sign-ins must not relink after explicit sign-out.
  invalidateOutstandingCloudConnectAttempts()
  const signOutEpoch = linkedCloudConnectAttempt
  const active = ensureActiveHelixProfile(userDataPath)
  const configState = getHelixCloudAuthConfig()
  const session = readCloudSession(active.profile.id, userDataPath)
  // Fence before network I/O so in-flight refreshes cannot save after sign-out.
  invalidateCloudSessionChanges(active.profile.id, userDataPath)
  if (!isHelixCloudDevAuthEnabled() && configState.configured && session.status === 'found') {
    await revokeHelixCloudSession(configState.config, session.session).catch(() => undefined)
  }
  if (linkedCloudConnectAttempt > signOutEpoch) {
    const current = ensureActiveHelixProfile(userDataPath)
    return {
      status: 'signed-out',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      activeProfileId: current.index.activeProfileId,
      profiles: current.index.profiles
    }
  }
  signOutCloudSession(active.profile.id, userDataPath)
  const list = unlinkHelixProfileFromCloud(active.profile.id, userDataPath)
  try {
    clearRelayRegionPreferenceCache(userDataPath)
  } catch {
    // A leftover latency cache must not fail the sign-out itself.
  }
  return {
    status: 'signed-out',
    auth: getCurrentHelixProfileAuthStatus(userDataPath),
    activeProfileId: list.activeProfileId,
    profiles: list.profiles
  }
}

export async function createCloudLinkedHelixProfile(
  userDataPath: string,
  args: CreateCloudLinkedHelixProfileArgs
): Promise<CreateCloudLinkedHelixProfileResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (isHelixCloudDevAuthEnabled()) {
    const result = createDevCloudLinkedHelixProfile(active, userDataPath, args)
    if (result.status !== 'created') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'created',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles,
      profile: result.list.profile
    }
  }

  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const operation = await runWithFreshHelixCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => createHelixCloudProfile(configState.config, session, args)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    const created = operation.value
    const list = createCloudLinkedHelixProfileRecord(
      created.cloud,
      { name: args.name },
      userDataPath
    )
    signInCloudSession(list.profile.id, userDataPath, created)
    return {
      status: 'created',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles,
      profile: list.profile
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function selectCurrentHelixProfileOrg(
  userDataPath: string,
  orgId: string
): Promise<SelectHelixProfileOrgResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (isHelixCloudDevAuthEnabled()) {
    const result = selectDevHelixCloudOrg(active, userDataPath, orgId)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }

  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const list = await selectCloudOrg({
      config: configState.config,
      active,
      userDataPath,
      orgId
    })
    if (!list) {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentHelixProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
