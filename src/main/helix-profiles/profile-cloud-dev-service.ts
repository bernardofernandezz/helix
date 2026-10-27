import type {
  CreateCloudLinkedHelixProfileArgs,
  HelixProfileListState
} from '../../shared/helix-profiles'
import type { ActiveHelixProfileState } from './profile-index-store'
import { createCloudLinkedHelixProfileRecord, linkHelixProfileToCloud } from './profile-cloud-index'
import { readCloudSession, signInCloudSession } from './profile-cloud-session-owner'
import { createDevHelixCloudSession } from './profile-cloud-dev-auth'

type DevProfileListResult = HelixProfileListState

type DevCreateProfileResult =
  | {
      status: 'created'
      list: ReturnType<typeof createCloudLinkedHelixProfileRecord>
    }
  | { status: 'reconnect-required' }

type DevMutationResult =
  | {
      status: 'updated'
      list: DevProfileListResult
    }
  | { status: 'reconnect-required' }

export function connectDevHelixCloudProfile(
  active: ActiveHelixProfileState,
  userDataPath: string
): DevProfileListResult {
  const session = createDevHelixCloudSession({ localProfileId: active.profile.id })
  signInCloudSession(active.profile.id, userDataPath, session)
  return linkHelixProfileToCloud(active.profile.id, session.cloud, userDataPath)
}

export function createDevCloudLinkedHelixProfile(
  active: ActiveHelixProfileState,
  userDataPath: string,
  args: CreateCloudLinkedHelixProfileArgs
): DevCreateProfileResult {
  if (readCloudSession(active.profile.id, userDataPath).status !== 'found') {
    return { status: 'reconnect-required' }
  }
  const session = createDevHelixCloudSession({ orgId: args.orgId })
  const list = createCloudLinkedHelixProfileRecord(session.cloud, { name: args.name }, userDataPath)
  signInCloudSession(list.profile.id, userDataPath, session)
  return { status: 'created', list }
}

export function refreshDevHelixCloudProfile(
  active: ActiveHelixProfileState,
  userDataPath: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevHelixCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId: active.profile.cloud.activeOrgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkHelixProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}

export function selectDevHelixCloudOrg(
  active: ActiveHelixProfileState,
  userDataPath: string,
  orgId: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevHelixCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkHelixProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}
