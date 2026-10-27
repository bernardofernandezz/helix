import type {
  HelixOrgMember,
  HelixOrgMembersRoster,
  HelixOrgPendingInvite,
  HelixProfileOrgMemberChangeRoleArgs,
  HelixProfileOrgMemberInviteArgs,
  HelixProfileOrgMemberMutationResult,
  HelixProfileOrgMemberRemoveArgs,
  HelixProfileOrgInviteRevokeArgs
} from '../../shared/helix-profiles'

// With no dev-auth server, this roster mirrors real membership states and mutation results.
type DevOrgRoster = {
  members: HelixOrgMember[]
  pendingInvites: HelixOrgPendingInvite[]
}

const devRostersByOrg = new Map<string, DevOrgRoster>()
const MAX_DEV_ORG_ROSTERS = 64

function cleanEnvString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function devSelf(): HelixOrgMember {
  return {
    userId: cleanEnvString(process.env.HELIX_CLOUD_DEV_USER_ID, 'dev-user'),
    email: cleanEnvString(process.env.HELIX_CLOUD_DEV_EMAIL, 'dev@helix.local'),
    displayName: cleanEnvString(process.env.HELIX_CLOUD_DEV_DISPLAY_NAME, 'Helix Dev'),
    role: 'owner'
  }
}

function seedDevRoster(): DevOrgRoster {
  return {
    members: [
      devSelf(),
      {
        userId: 'dev-teammate-1',
        email: 'teammate@helix.local',
        displayName: 'Dev Teammate',
        role: 'admin'
      },
      // Null user IDs exercise members who have not signed in yet.
      { userId: null, email: 'invited-member@helix.local', displayName: undefined, role: 'member' }
    ],
    pendingInvites: [{ email: 'pending@helix.local', role: 'member', createdAt: Date.now() }]
  }
}

function getDevRoster(orgId: string): DevOrgRoster {
  const existing = devRostersByOrg.get(orgId)
  if (existing) {
    return existing
  }
  const seeded = seedDevRoster()
  devRostersByOrg.set(orgId, seeded)
  while (devRostersByOrg.size > MAX_DEV_ORG_ROSTERS) {
    const oldest = devRostersByOrg.keys().next()
    if (oldest.done) {
      break
    }
    devRostersByOrg.delete(oldest.value)
  }
  return seeded
}

export function listDevHelixCloudOrgMembers(orgId: string): HelixOrgMembersRoster {
  const roster = getDevRoster(orgId)
  return {
    members: roster.members.map((member) => ({ ...member })),
    pendingInvites: roster.pendingInvites.map((invite) => ({ ...invite })),
    viewerRole: 'owner',
    canManageMembers: true
  }
}

export function inviteDevHelixCloudOrgMember(
  args: HelixProfileOrgMemberInviteArgs
): HelixProfileOrgMemberMutationResult {
  const roster = getDevRoster(args.orgId)
  const email = args.email.toLowerCase()
  if (roster.members.some((member) => member.email.toLowerCase() === email)) {
    return { status: 'conflict', reason: 'already_member' }
  }
  if (roster.pendingInvites.some((invite) => invite.email.toLowerCase() === email)) {
    return { status: 'conflict', reason: 'already_invited' }
  }
  roster.pendingInvites.push({ email: args.email, role: args.role, createdAt: Date.now() })
  return { status: 'ok' }
}

export function revokeDevHelixCloudOrgInvite(
  args: HelixProfileOrgInviteRevokeArgs
): HelixProfileOrgMemberMutationResult {
  const roster = getDevRoster(args.orgId)
  const email = args.email.toLowerCase()
  const index = roster.pendingInvites.findIndex((invite) => invite.email.toLowerCase() === email)
  if (index === -1) {
    return { status: 'not-found' }
  }
  roster.pendingInvites.splice(index, 1)
  return { status: 'ok' }
}

export function changeDevHelixCloudOrgMemberRole(
  args: HelixProfileOrgMemberChangeRoleArgs
): HelixProfileOrgMemberMutationResult {
  const roster = getDevRoster(args.orgId)
  if (args.userId === devSelf().userId) {
    return { status: 'invalid', reason: 'cannot_change_own_role' }
  }
  const member = roster.members.find((candidate) => candidate.userId === args.userId)
  if (!member) {
    return { status: 'not-found' }
  }
  member.role = args.role
  return { status: 'ok' }
}

export function removeDevHelixCloudOrgMember(
  args: HelixProfileOrgMemberRemoveArgs
): HelixProfileOrgMemberMutationResult {
  const roster = getDevRoster(args.orgId)
  if (args.userId === devSelf().userId) {
    return { status: 'invalid', reason: 'cannot_remove_self' }
  }
  const index = roster.members.findIndex((candidate) => candidate.userId === args.userId)
  if (index === -1) {
    return { status: 'not-found' }
  }
  roster.members.splice(index, 1)
  return { status: 'ok' }
}
