import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HelixOrgMembersRoster } from '../../shared/helix-profiles'
import { HelixCloudRequestError } from './profile-cloud-client'

const {
  runWithFreshHelixCloudSessionMock,
  listHelixCloudOrgMembersMock,
  inviteHelixCloudOrgMemberMock,
  revokeHelixCloudOrgInviteMock,
  changeHelixCloudOrgMemberRoleMock,
  removeHelixCloudOrgMemberMock
} = vi.hoisted(() => ({
  runWithFreshHelixCloudSessionMock: vi.fn(),
  listHelixCloudOrgMembersMock: vi.fn(),
  inviteHelixCloudOrgMemberMock: vi.fn(),
  revokeHelixCloudOrgInviteMock: vi.fn(),
  changeHelixCloudOrgMemberRoleMock: vi.fn(),
  removeHelixCloudOrgMemberMock: vi.fn()
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath }
}))

vi.mock('./profile-cloud-session-refresh', () => ({
  runWithFreshHelixCloudSessionMock,
  runWithFreshHelixCloudSession: runWithFreshHelixCloudSessionMock
}))

vi.mock('./profile-cloud-org-members-client', () => ({
  listHelixCloudOrgMembers: listHelixCloudOrgMembersMock,
  inviteHelixCloudOrgMember: inviteHelixCloudOrgMemberMock,
  revokeHelixCloudOrgInvite: revokeHelixCloudOrgInviteMock,
  changeHelixCloudOrgMemberRole: changeHelixCloudOrgMemberRoleMock,
  removeHelixCloudOrgMember: removeHelixCloudOrgMemberMock
}))

import {
  changeHelixProfileOrgMemberRole,
  inviteHelixProfileOrgMember,
  listHelixProfileOrgMembers,
  removeHelixProfileOrgMember,
  revokeHelixProfileOrgInvite
} from './profile-cloud-org-members-service'

const fakeSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 3_600_000,
  capabilities: { flags: {}, refreshedAt: 1 }
}

// Business 4xx return as values, so the session layer sees only thrown auth failures.
function runOperationDirectly(): void {
  runWithFreshHelixCloudSessionMock.mockImplementation(
    async (
      _config: unknown,
      _active: unknown,
      _path: unknown,
      op: (session: unknown) => unknown
    ) => ({
      status: 'ok',
      value: await op(fakeSession)
    })
  )
}

function configureCloudEnv(): void {
  vi.stubEnv('HELIX_CLOUD_API_URL', 'https://helix-cloud.example')
  vi.stubEnv('HELIX_CLOUD_CLIENT_ID', 'desktop-client')
}

const roster: HelixOrgMembersRoster = {
  members: [{ userId: 'user-1', email: 'nina@example.com', role: 'owner' }],
  pendingInvites: [],
  viewerRole: 'owner',
  canManageMembers: true
}

describe('Helix cloud org members service (configured)', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'helix-org-members-'))
    runWithFreshHelixCloudSessionMock.mockReset()
    listHelixCloudOrgMembersMock.mockReset()
    inviteHelixCloudOrgMemberMock.mockReset()
    revokeHelixCloudOrgInviteMock.mockReset()
    changeHelixCloudOrgMemberRoleMock.mockReset()
    removeHelixCloudOrgMemberMock.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('HELIX_CLOUD_DEV_AUTH', '')
    vi.stubEnv('HELIX_CLOUD_API_URL', '')
    vi.stubEnv('HELIX_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('reports unconfigured when cloud sign-in is not set up', async () => {
    await expect(listHelixProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'unconfigured'
    })
    expect(runWithFreshHelixCloudSessionMock).not.toHaveBeenCalled()
  })

  it('returns the roster from the client', async () => {
    configureCloudEnv()
    runOperationDirectly()
    listHelixCloudOrgMembersMock.mockResolvedValue(roster)

    await expect(listHelixProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'ok',
      roster
    })
    expect(listHelixCloudOrgMembersMock).toHaveBeenCalledWith(
      expect.any(Object),
      fakeSession,
      'org-1'
    )
  })

  it('maps a 409 already_member invite conflict', async () => {
    configureCloudEnv()
    runOperationDirectly()
    inviteHelixCloudOrgMemberMock.mockRejectedValue(
      new HelixCloudRequestError(409, 'already_member')
    )

    await expect(
      inviteHelixProfileOrgMember(userDataPath, {
        orgId: 'org-1',
        email: 'a@b.com',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'conflict', reason: 'already_member' })
  })

  it('maps a 403 role change to forbidden', async () => {
    configureCloudEnv()
    runOperationDirectly()
    changeHelixCloudOrgMemberRoleMock.mockRejectedValue(new HelixCloudRequestError(403))

    await expect(
      changeHelixProfileOrgMemberRole(userDataPath, {
        orgId: 'org-1',
        userId: 'user-2',
        role: 'admin'
      })
    ).resolves.toEqual({ status: 'forbidden' })
  })

  it('maps a 400 cannot_remove_self to an invalid result', async () => {
    configureCloudEnv()
    runOperationDirectly()
    removeHelixCloudOrgMemberMock.mockRejectedValue(
      new HelixCloudRequestError(400, 'cannot_remove_self')
    )

    await expect(
      removeHelixProfileOrgMember(userDataPath, { orgId: 'org-1', userId: 'user-1' })
    ).resolves.toEqual({ status: 'invalid', reason: 'cannot_remove_self' })
  })

  it('maps a 404 revoke to not-found', async () => {
    configureCloudEnv()
    runOperationDirectly()
    revokeHelixCloudOrgInviteMock.mockRejectedValue(new HelixCloudRequestError(404))

    await expect(
      revokeHelixProfileOrgInvite(userDataPath, { orgId: 'org-1', email: 'gone@b.com' })
    ).resolves.toEqual({ status: 'not-found' })
  })

  it('reports reconnect-required when the session layer cannot refresh', async () => {
    configureCloudEnv()
    runWithFreshHelixCloudSessionMock.mockResolvedValue({ status: 'reconnect-required' })

    await expect(listHelixProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'reconnect-required'
    })
  })
})

describe('Helix cloud org members service (dev auth)', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'helix-org-members-dev-'))
    runWithFreshHelixCloudSessionMock.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('HELIX_CLOUD_DEV_AUTH', '1')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('serves an in-memory roster the caller can manage', async () => {
    const result = await listHelixProfileOrgMembers(userDataPath, 'dev-list-org')
    if (result.status !== 'ok') {
      throw new Error(`Expected ok, got ${result.status}`)
    }
    expect(result.roster.canManageMembers).toBe(true)
    expect(result.roster.viewerRole).toBe('owner')
    expect(result.roster.members[0]).toMatchObject({ role: 'owner' })
    expect(result.roster.members.some((member) => member.userId === null)).toBe(true)
    expect(result.roster.pendingInvites.length).toBeGreaterThan(0)
    expect(runWithFreshHelixCloudSessionMock).not.toHaveBeenCalled()
  })

  it('mutates the dev roster across invite and revoke', async () => {
    const orgId = 'dev-mutate-org'
    await expect(
      inviteHelixProfileOrgMember(userDataPath, {
        orgId,
        email: 'fresh@helix.local',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'ok' })

    const afterInvite = await listHelixProfileOrgMembers(userDataPath, orgId)
    if (afterInvite.status !== 'ok') {
      throw new Error('expected ok')
    }
    expect(afterInvite.roster.pendingInvites.some((i) => i.email === 'fresh@helix.local')).toBe(
      true
    )

    await expect(
      inviteHelixProfileOrgMember(userDataPath, {
        orgId,
        email: 'fresh@helix.local',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'conflict', reason: 'already_invited' })

    await expect(
      revokeHelixProfileOrgInvite(userDataPath, { orgId, email: 'fresh@helix.local' })
    ).resolves.toEqual({ status: 'ok' })
    await expect(
      revokeHelixProfileOrgInvite(userDataPath, { orgId, email: 'fresh@helix.local' })
    ).resolves.toEqual({ status: 'not-found' })
  })

  it('blocks changing the dev owner (self) role', async () => {
    const orgId = 'dev-self-org'
    const list = await listHelixProfileOrgMembers(userDataPath, orgId)
    if (list.status !== 'ok') {
      throw new Error('expected ok')
    }
    const self = list.roster.members.find((member) => member.role === 'owner')
    await expect(
      changeHelixProfileOrgMemberRole(userDataPath, {
        orgId,
        userId: self?.userId ?? 'dev-user',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'invalid', reason: 'cannot_change_own_role' })
  })
})
