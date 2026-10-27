import type {
  HelixProfileOrgInviteRevokeArgs,
  HelixProfileOrgMemberChangeRoleArgs,
  HelixProfileOrgMemberInviteArgs,
  HelixProfileOrgMemberMutationResult,
  HelixProfileOrgMemberRemoveArgs,
  HelixProfileOrgMembersListResult
} from '../../shared/helix-profiles'
import type { ActiveHelixProfileState } from './profile-index-store'
import { ensureActiveHelixProfile } from './profile-index-store'
import type { HelixCloudAuthConfig } from './profile-cloud-auth-config'
import { getHelixCloudAuthConfig, isHelixCloudDevAuthEnabled } from './profile-cloud-auth-config'
import type { HelixCloudSession } from './profile-cloud-session-store'
import { HelixCloudRequestError } from './profile-cloud-client'
import { runWithFreshHelixCloudSession } from './profile-cloud-session-refresh'
import {
  changeHelixCloudOrgMemberRole,
  inviteHelixCloudOrgMember,
  listHelixCloudOrgMembers,
  removeHelixCloudOrgMember,
  revokeHelixCloudOrgInvite
} from './profile-cloud-org-members-client'
import {
  changeDevHelixCloudOrgMemberRole,
  inviteDevHelixCloudOrgMember,
  listDevHelixCloudOrgMembers,
  removeDevHelixCloudOrgMember,
  revokeDevHelixCloudOrgInvite
} from './profile-cloud-dev-org-members'

type OrgCallResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'reconnect-required' }
  | { status: 'request-error'; error: HelixCloudRequestError }
  | { status: 'failed'; error: string }

// Only 401 should trigger session refresh; return business/permission failures as values.
async function runOrgMemberCall<T>(
  config: HelixCloudAuthConfig,
  active: ActiveHelixProfileState,
  userDataPath: string,
  call: (session: HelixCloudSession) => Promise<T>
): Promise<OrgCallResult<T>> {
  try {
    const operation = await runWithFreshHelixCloudSession(
      config,
      active,
      userDataPath,
      async (session) => {
        try {
          return { ok: true as const, value: await call(session) }
        } catch (error) {
          if (error instanceof HelixCloudRequestError && error.statusCode !== 401) {
            return { ok: false as const, error }
          }
          throw error
        }
      }
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required' }
    }
    const outcome = operation.value
    return outcome.ok
      ? { status: 'ok', value: outcome.value }
      : { status: 'request-error', error: outcome.error }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

function mapMutationRequestError(
  error: HelixCloudRequestError
): HelixProfileOrgMemberMutationResult {
  switch (error.statusCode) {
    case 403:
      return { status: 'forbidden' }
    case 404:
      return { status: 'not-found' }
    case 409:
      return {
        status: 'conflict',
        reason: error.errorCode === 'already_member' ? 'already_member' : 'already_invited'
      }
    case 400:
      return {
        status: 'invalid',
        reason:
          error.errorCode === 'cannot_remove_self' ? 'cannot_remove_self' : 'cannot_change_own_role'
      }
    default:
      return { status: 'failed', error: error.message }
  }
}

function mapMutationResult(result: OrgCallResult<void>): HelixProfileOrgMemberMutationResult {
  switch (result.status) {
    case 'ok':
      return { status: 'ok' }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return mapMutationRequestError(result.error)
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function listHelixProfileOrgMembers(
  userDataPath: string,
  orgId: string
): Promise<HelixProfileOrgMembersListResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (isHelixCloudDevAuthEnabled()) {
    return { status: 'ok', roster: listDevHelixCloudOrgMembers(orgId) }
  }
  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  const result = await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
    listHelixCloudOrgMembers(configState.config, session, orgId)
  )
  switch (result.status) {
    case 'ok':
      return { status: 'ok', roster: result.value }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return { status: 'failed', error: result.error.message }
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function inviteHelixProfileOrgMember(
  userDataPath: string,
  args: HelixProfileOrgMemberInviteArgs
): Promise<HelixProfileOrgMemberMutationResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (isHelixCloudDevAuthEnabled()) {
    return inviteDevHelixCloudOrgMember(args)
  }
  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      inviteHelixCloudOrgMember(configState.config, session, args)
    )
  )
}

export async function revokeHelixProfileOrgInvite(
  userDataPath: string,
  args: HelixProfileOrgInviteRevokeArgs
): Promise<HelixProfileOrgMemberMutationResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (isHelixCloudDevAuthEnabled()) {
    return revokeDevHelixCloudOrgInvite(args)
  }
  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      revokeHelixCloudOrgInvite(configState.config, session, args)
    )
  )
}

export async function changeHelixProfileOrgMemberRole(
  userDataPath: string,
  args: HelixProfileOrgMemberChangeRoleArgs
): Promise<HelixProfileOrgMemberMutationResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (isHelixCloudDevAuthEnabled()) {
    return changeDevHelixCloudOrgMemberRole(args)
  }
  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      changeHelixCloudOrgMemberRole(configState.config, session, args)
    )
  )
}

export async function removeHelixProfileOrgMember(
  userDataPath: string,
  args: HelixProfileOrgMemberRemoveArgs
): Promise<HelixProfileOrgMemberMutationResult> {
  const active = ensureActiveHelixProfile(userDataPath)
  if (isHelixCloudDevAuthEnabled()) {
    return removeDevHelixCloudOrgMember(args)
  }
  const configState = getHelixCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      removeHelixCloudOrgMember(configState.config, session, args)
    )
  )
}
