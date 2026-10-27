import { HELIX_BROWSER_PARTITION } from './constants'
import type { ExecutionHostId } from './execution-host'

export const HELIX_PROFILE_INDEX_SCHEMA_VERSION = 1
export const DEFAULT_LOCAL_HELIX_PROFILE_ID = 'local-default'
export const DEFAULT_LOCAL_HELIX_PROFILE_NAME = 'Personal'
/** Main -> renderer push when the stored auth status changed without the renderer asking. */
export const HELIX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL = 'helixProfiles:authStatusChanged'
export const HELIX_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL = 'helixProfiles:signInProgressChanged'
const LEGACY_HELIX_BROWSER_SESSION_PARTITION_PREFIX = 'persist:helix-browser-session-'

export type HelixProfileAvatar = {
  kind: 'initials'
  initials: string
  color: 'neutral'
}

export type HelixProfileKind = 'local' | 'cloud-linked'

export type HelixProfileCloudSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type HelixCloudOrgSummary = {
  orgId: string
  name: string
  role?: string
}

export type HelixCloudCapabilityFlags = Record<string, boolean>

export type HelixCloudCapabilities = {
  flags: HelixCloudCapabilityFlags
  refreshedAt: number
}

export type HelixCloudSessionPersistence = 'none' | 'encrypted' | 'memory-only' | 'dev-plaintext'

export type HelixProfileAuthState = 'local' | 'unconfigured' | 'connected' | 'reconnect-required'

export type HelixProfileAuthStatus = {
  activeProfileId: string
  configured: boolean
  state: HelixProfileAuthState
  persistence: HelixCloudSessionPersistence
  cloud?: HelixProfileCloudSummary
  organizations?: HelixCloudOrgSummary[]
  capabilities?: HelixCloudCapabilities
  credentialError?: string
  setupMessage?: string
}

export type HelixProfileSummary = {
  id: string
  name: string
  avatar: HelixProfileAvatar
  kind: HelixProfileKind
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  cloud?: HelixProfileCloudSummary
}

export type HelixProfileIndex = {
  schemaVersion: number
  activeProfileId: string
  profiles: HelixProfileSummary[]
}

export type HelixProfileListState = {
  activeProfileId: string
  profiles: HelixProfileSummary[]
}

export type HelixProfileListResult = HelixProfileListState & {
  // Gate the multi-profile switcher; default builds use one-profile account menus.
  multiProfileUi: boolean
}

export type CreateLocalHelixProfileArgs = {
  name?: string
}

export type CreateLocalHelixProfileResult = HelixProfileListState & {
  profile: HelixProfileSummary
}

export type CreateCloudLinkedHelixProfileArgs = {
  orgId?: string
  name?: string
}

export type SwitchHelixProfileArgs = {
  profileId: string
}

export type SwitchHelixProfileResult = {
  status: 'already-active' | 'relaunching'
}

export type TransferHelixProfileProjectMode = 'move' | 'copy'

export type TransferHelixProfileProjectArgs = {
  sourceProfileId: string
  targetProfileId: string
  repoId: string
  mode: TransferHelixProfileProjectMode
}

export type FindHelixProfileProjectsByPathArgs = {
  path: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  excludeProfileId?: string | null
}

export type HelixProfileProjectPresence = {
  profileId: string
  profileName: string
  profileKind: HelixProfileKind
  repoId: string
  repoName: string
}

export type FindHelixProfileProjectsByPathResult = {
  projects: HelixProfileProjectPresence[]
}

export type TransferHelixProfileProjectResult =
  | {
      status: 'transferred'
      mode: TransferHelixProfileProjectMode
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      targetRepoId: string
      targetProjectId: string | null
      willRelaunch?: boolean
    }
  | {
      status: 'duplicate-target'
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      duplicateRepoId: string
    }

/** A sign-in in flight; `link` is set only while the browser has not answered yet. */
export type HelixCloudSignInProgress = { link: string | null }

export type ConnectCurrentHelixProfileResult =
  | {
      status: 'connected'
      auth: HelixProfileAuthStatus
      activeProfileId: string
      profiles: HelixProfileSummary[]
    }
  | {
      status: 'unconfigured'
      auth: HelixProfileAuthStatus
    }
  | {
      status: 'cancelled'
      auth: HelixProfileAuthStatus
    }
  | {
      status: 'timed-out'
      auth: HelixProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: HelixProfileAuthStatus
      error: string
    }

export type CreateCloudLinkedHelixProfileResult =
  | {
      status: 'created'
      auth: HelixProfileAuthStatus
      activeProfileId: string
      profiles: HelixProfileSummary[]
      profile: HelixProfileSummary
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: HelixProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: HelixProfileAuthStatus
      error: string
    }

export type SignOutCurrentHelixProfileResult = {
  status: 'signed-out'
  auth: HelixProfileAuthStatus
  activeProfileId: string
  profiles: HelixProfileSummary[]
}

export type SelectHelixProfileOrgArgs = {
  orgId: string
}

export type SelectHelixProfileOrgResult =
  | {
      status: 'selected'
      auth: HelixProfileAuthStatus
      activeProfileId: string
      profiles: HelixProfileSummary[]
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: HelixProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: HelixProfileAuthStatus
      error: string
    }

export type RefreshCurrentHelixProfileAuthResult =
  | {
      status: 'refreshed'
      auth: HelixProfileAuthStatus
      activeProfileId: string
      profiles: HelixProfileSummary[]
    }
  | {
      status: 'local' | 'unconfigured' | 'reconnect-required'
      auth: HelixProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: HelixProfileAuthStatus
      error: string
    }

// Mirror the server’s fixed role enum so UI options cannot drift from accepted API values.
export type HelixOrgRole = 'owner' | 'admin' | 'member'

export type HelixOrgMember = {
  // Provisioned teammates without sign-in have no userId; disable mutations requiring that key.
  userId: string | null
  email: string
  displayName?: string
  role: HelixOrgRole
}

export type HelixOrgPendingInvite = {
  email: string
  role: HelixOrgRole
  createdAt: number
}

export type HelixOrgMembersRoster = {
  members: HelixOrgMember[]
  pendingInvites: HelixOrgPendingInvite[]
  viewerRole: HelixOrgRole
  canManageMembers: boolean
}

export type HelixProfileOrgMembersListArgs = {
  orgId: string
}

export type HelixProfileOrgMemberInviteArgs = {
  orgId: string
  email: string
  role: HelixOrgRole
}

export type HelixProfileOrgInviteRevokeArgs = {
  orgId: string
  email: string
}

export type HelixProfileOrgMemberChangeRoleArgs = {
  orgId: string
  userId: string
  role: HelixOrgRole
}

export type HelixProfileOrgMemberRemoveArgs = {
  orgId: string
  userId: string
}

export type HelixProfileOrgMembersListResult =
  | { status: 'ok'; roster: HelixOrgMembersRoster }
  | { status: 'unconfigured' | 'reconnect-required' }
  | { status: 'failed'; error: string }

export type HelixOrgInviteConflictReason = 'already_member' | 'already_invited'
export type HelixOrgMutationInvalidReason = 'cannot_change_own_role' | 'cannot_remove_self'

export type HelixProfileOrgMemberMutationResult =
  | { status: 'ok' }
  | { status: 'unconfigured' | 'reconnect-required' | 'forbidden' | 'not-found' }
  | { status: 'conflict'; reason: HelixOrgInviteConflictReason }
  | { status: 'invalid'; reason: HelixOrgMutationInvalidReason }
  | { status: 'failed'; error: string }

export function createDefaultLocalHelixProfile(now: number): HelixProfileSummary {
  return {
    id: DEFAULT_LOCAL_HELIX_PROFILE_ID,
    name: DEFAULT_LOCAL_HELIX_PROFILE_NAME,
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
}

function profilePartitionHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getHelixProfileBrowserPartitionSegment(profileId: string): string {
  const safe = profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'profile'
  return `${safe}-${profilePartitionHash(profileId)}`
}

export function getHelixProfileBrowserDefaultPartition(profileId: string): string {
  if (profileId === DEFAULT_LOCAL_HELIX_PROFILE_ID) {
    return HELIX_BROWSER_PARTITION
  }
  return `persist:helix-profile-${getHelixProfileBrowserPartitionSegment(profileId)}-browser-default`
}

export function getHelixProfileBrowserSessionPartition(
  profileId: string,
  browserSessionProfileId: string
): string {
  if (profileId === DEFAULT_LOCAL_HELIX_PROFILE_ID) {
    return `${LEGACY_HELIX_BROWSER_SESSION_PARTITION_PREFIX}${browserSessionProfileId}`
  }
  return `persist:helix-profile-${getHelixProfileBrowserPartitionSegment(
    profileId
  )}-browser-session-${browserSessionProfileId}`
}
