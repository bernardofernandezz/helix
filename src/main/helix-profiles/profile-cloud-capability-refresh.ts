import type { RefreshCurrentHelixProfileAuthResult } from '../../shared/helix-profiles'
import { getHelixCloudAuthConfig, isHelixCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { getHelixProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { refreshHelixCloudCapabilities } from './profile-cloud-client'
import { ensureActiveHelixProfile } from './profile-index-store'
import { refreshDevHelixCloudProfile } from './profile-cloud-dev-service'
import {
  commitCloudSessionCapabilities,
  takeCloudSessionTicket,
  type CloudSessionTicket
} from './profile-cloud-session-owner'
import { runWithFreshHelixCloudSession } from './profile-cloud-session-refresh'

export async function refreshCurrentHelixProfileAuth(
  userDataPath: string
): Promise<RefreshCurrentHelixProfileAuthResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  const auth = () => getHelixProfileAuthStatusFromProfile(active, userDataPath)
  if (!active.profile.cloud) {
    return { status: 'local', auth: auth() }
  }
  if (isHelixCloudDevAuthEnabled()) {
    const result = refreshDevHelixCloudProfile(active, userDataPath)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: auth(),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }
  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: auth() }
  }
  try {
    const cloud = active.profile.cloud
    let ticket: CloudSessionTicket | undefined
    const operation = await runWithFreshHelixCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => {
        // Take the ticket after refresh because refreshing may relink the session.
        ticket = takeCloudSessionTicket(active.profile.id, userDataPath)
        return refreshHelixCloudCapabilities(configState.config, session)
      }
    )
    if (operation.status !== 'ok' || !ticket) {
      return { status: 'reconnect-required', auth: auth() }
    }
    const refresh = operation.value
    if (
      refresh.cloud &&
      (refresh.cloud.userId !== cloud.userId ||
        refresh.cloud.cloudProfileId !== cloud.cloudProfileId)
    ) {
      throw new Error('helix_cloud_identity_changed_during_capability_refresh')
    }
    const list = commitCloudSessionCapabilities(active.profile.id, userDataPath, ticket, refresh)
    if (!list) {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: getHelixProfileAuthStatusFromProfile(
        ensureActiveHelixProfile(userDataPath),
        userDataPath
      ),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: auth(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
