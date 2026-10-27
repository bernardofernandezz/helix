import type { HelixCloudAuthConfig } from '../../helix-profiles/profile-cloud-auth-config'
import { ensureActiveHelixProfile } from '../../helix-profiles/profile-index-store'
import { readFreshHelixCloudSession } from '../../helix-profiles/profile-cloud-session-refresh'
import type { RelayAuthContext } from './relay-auth-identity'

export async function readRelayAuthContext(
  authConfig: HelixCloudAuthConfig,
  userDataPath: string
): Promise<RelayAuthContext | null> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (!active.profile.cloud) {
    return null
  }
  const session = await readFreshHelixCloudSession(authConfig, active, userDataPath)
  if (session.status !== 'found') {
    return null
  }
  // Refresh/org selection can change linkage; derive identity from post-refresh profile state.
  const refreshed = ensureActiveHelixProfile(userDataPath)
  const cloud = refreshed.profile.cloud
  if (!cloud || refreshed.profile.id !== active.profile.id) {
    return null
  }
  return {
    identity: {
      userId: cloud.userId,
      profileId: cloud.cloudProfileId,
      organizationId: cloud.activeOrgId ?? ''
    },
    accessToken: session.session.accessToken,
    relayEntitled: session.session.capabilities.flags['relay.use'] === true
  }
}
