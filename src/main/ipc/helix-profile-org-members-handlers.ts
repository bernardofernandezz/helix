import { ipcMain } from 'electron'
import type {
  HelixOrgRole,
  HelixProfileOrgInviteRevokeArgs,
  HelixProfileOrgMemberChangeRoleArgs,
  HelixProfileOrgMemberInviteArgs,
  HelixProfileOrgMemberMutationResult,
  HelixProfileOrgMemberRemoveArgs,
  HelixProfileOrgMembersListArgs,
  HelixProfileOrgMembersListResult
} from '../../shared/helix-profiles'
import { getProfileUserDataPath } from '../helix-profiles/profile-storage-paths'
import {
  changeHelixProfileOrgMemberRole,
  inviteHelixProfileOrgMember,
  listHelixProfileOrgMembers,
  removeHelixProfileOrgMember,
  revokeHelixProfileOrgInvite
} from '../helix-profiles/profile-cloud-org-members-service'

function orgMembersScopedArgs(args: unknown): { orgId: string; record: Record<string, unknown> } {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_helix_profile_org_selection')
  }
  const record = args as Record<string, unknown>
  const orgId = typeof record.orgId === 'string' ? record.orgId.trim() : ''
  if (!orgId) {
    throw new Error('invalid_helix_profile_org_selection')
  }
  return { orgId, record }
}

function orgRoleFromUnknown(value: unknown): HelixOrgRole {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value
  }
  throw new Error('invalid_helix_org_role')
}

function orgEmailFromUnknown(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : ''
  if (!email) {
    throw new Error('invalid_helix_org_member_email')
  }
  return email
}

function orgUserIdFromUnknown(value: unknown): string {
  const userId = typeof value === 'string' ? value.trim() : ''
  if (!userId) {
    throw new Error('invalid_helix_org_member_user')
  }
  return userId
}

function orgMemberInviteArgsFromUnknown(args: unknown): HelixProfileOrgMemberInviteArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email), role: orgRoleFromUnknown(record.role) }
}

function orgInviteRevokeArgsFromUnknown(args: unknown): HelixProfileOrgInviteRevokeArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email) }
}

function orgMemberChangeRoleArgsFromUnknown(args: unknown): HelixProfileOrgMemberChangeRoleArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return {
    orgId,
    userId: orgUserIdFromUnknown(record.userId),
    role: orgRoleFromUnknown(record.role)
  }
}

function orgMemberRemoveArgsFromUnknown(args: unknown): HelixProfileOrgMemberRemoveArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, userId: orgUserIdFromUnknown(record.userId) }
}

export function registerHelixProfileOrgMemberHandlers(): void {
  ipcMain.handle(
    'helixProfiles:orgMembersList',
    async (
      _event,
      rawArgs: HelixProfileOrgMembersListArgs
    ): Promise<HelixProfileOrgMembersListResult> =>
      listHelixProfileOrgMembers(getProfileUserDataPath(), orgMembersScopedArgs(rawArgs).orgId)
  )

  ipcMain.handle(
    'helixProfiles:orgMemberInvite',
    async (
      _event,
      rawArgs: HelixProfileOrgMemberInviteArgs
    ): Promise<HelixProfileOrgMemberMutationResult> =>
      inviteHelixProfileOrgMember(getProfileUserDataPath(), orgMemberInviteArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'helixProfiles:orgInviteRevoke',
    async (
      _event,
      rawArgs: HelixProfileOrgInviteRevokeArgs
    ): Promise<HelixProfileOrgMemberMutationResult> =>
      revokeHelixProfileOrgInvite(getProfileUserDataPath(), orgInviteRevokeArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'helixProfiles:orgMemberChangeRole',
    async (
      _event,
      rawArgs: HelixProfileOrgMemberChangeRoleArgs
    ): Promise<HelixProfileOrgMemberMutationResult> =>
      changeHelixProfileOrgMemberRole(
        getProfileUserDataPath(),
        orgMemberChangeRoleArgsFromUnknown(rawArgs)
      )
  )

  ipcMain.handle(
    'helixProfiles:orgMemberRemove',
    async (
      _event,
      rawArgs: HelixProfileOrgMemberRemoveArgs
    ): Promise<HelixProfileOrgMemberMutationResult> =>
      removeHelixProfileOrgMember(getProfileUserDataPath(), orgMemberRemoveArgsFromUnknown(rawArgs))
  )
}
