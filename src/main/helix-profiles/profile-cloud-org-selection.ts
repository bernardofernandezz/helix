import type { HelixCloudAuthConfig } from './profile-cloud-auth-config'
import { HelixCloudRequestError, selectHelixCloudOrg } from './profile-cloud-client'
import { forceRefreshHelixCloudSession } from './profile-cloud-session-refresh'
import type { ActiveHelixProfileState } from './profile-index-store'
import type { HelixProfileListState } from '../../shared/helix-profiles'
import {
  beginCloudSessionRelink,
  commitCloudSessionRelink,
  readCloudSession
} from './profile-cloud-session-owner'

export async function selectCloudOrg(input: {
  config: HelixCloudAuthConfig
  active: ActiveHelixProfileState
  userDataPath: string
  orgId: string
}): Promise<HelixProfileListState | null> {
  const profileId = input.active.profile.id
  const cloud = input.active.profile.cloud
  const stored = readCloudSession(profileId, input.userDataPath)
  if (!cloud || stored.status !== 'found') {
    return null
  }
  const ticket = beginCloudSessionRelink(profileId, input.userDataPath)
  let selected
  try {
    selected = await selectHelixCloudOrg(input.config, stored.session, input.orgId)
  } catch (error) {
    if (!(error instanceof HelixCloudRequestError) || error.statusCode !== 401) {
      throw error
    }
    const refreshed = await forceRefreshHelixCloudSession(
      input.config,
      input.active,
      input.userDataPath,
      stored.session
    )
    if (refreshed.status !== 'found') {
      throw error
    }
    selected = await selectHelixCloudOrg(input.config, refreshed.session, input.orgId)
  }
  if (
    selected.cloud.userId !== cloud.userId ||
    selected.cloud.cloudProfileId !== cloud.cloudProfileId ||
    selected.cloud.activeOrgId !== input.orgId
  ) {
    throw new Error('helix_cloud_org_selection_identity_mismatch')
  }
  const list = commitCloudSessionRelink(profileId, input.userDataPath, ticket, selected)
  if (!list) {
    throw new Error('stale_cloud_session_mutation')
  }
  return list
}
