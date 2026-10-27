import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  listHelixProfileOrgMembersMock,
  inviteHelixProfileOrgMemberMock,
  revokeHelixProfileOrgInviteMock,
  changeHelixProfileOrgMemberRoleMock,
  removeHelixProfileOrgMemberMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  listHelixProfileOrgMembersMock: vi.fn(),
  inviteHelixProfileOrgMemberMock: vi.fn(),
  revokeHelixProfileOrgInviteMock: vi.fn(),
  changeHelixProfileOrgMemberRoleMock: vi.fn(),
  removeHelixProfileOrgMemberMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../helix-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/tmp/helix-user-data'
}))

vi.mock('../helix-profiles/profile-cloud-org-members-service', () => ({
  listHelixProfileOrgMembers: listHelixProfileOrgMembersMock,
  inviteHelixProfileOrgMember: inviteHelixProfileOrgMemberMock,
  revokeHelixProfileOrgInvite: revokeHelixProfileOrgInviteMock,
  changeHelixProfileOrgMemberRole: changeHelixProfileOrgMemberRoleMock,
  removeHelixProfileOrgMember: removeHelixProfileOrgMemberMock
}))

import { registerHelixProfileOrgMemberHandlers } from './helix-profile-org-members-handlers'

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler for ${channel}`)
  }
  return handler({}, args)
}

describe('registerHelixProfileOrgMemberHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    listHelixProfileOrgMembersMock.mockReset().mockResolvedValue({ status: 'ok', roster: {} })
    inviteHelixProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    revokeHelixProfileOrgInviteMock.mockReset().mockResolvedValue({ status: 'ok' })
    changeHelixProfileOrgMemberRoleMock.mockReset().mockResolvedValue({ status: 'ok' })
    removeHelixProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    registerHelixProfileOrgMemberHandlers()
  })

  it('registers all five org-member channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'helixProfiles:orgInviteRevoke',
        'helixProfiles:orgMemberChangeRole',
        'helixProfiles:orgMemberInvite',
        'helixProfiles:orgMemberRemove',
        'helixProfiles:orgMembersList'
      ].sort()
    )
  })

  it('forwards a valid invite to the service with a trimmed email', async () => {
    await invoke('helixProfiles:orgMemberInvite', {
      orgId: 'org-1',
      email: '  new@example.com  ',
      role: 'admin'
    })
    expect(inviteHelixProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/helix-user-data', {
      orgId: 'org-1',
      email: 'new@example.com',
      role: 'admin'
    })
  })

  it('rejects an invite with a missing org id', async () => {
    await expect(
      invoke('helixProfiles:orgMemberInvite', { email: 'a@b.com', role: 'member' })
    ).rejects.toThrow('invalid_helix_profile_org_selection')
    expect(inviteHelixProfileOrgMemberMock).not.toHaveBeenCalled()
  })

  it('rejects an invite with an unknown role', async () => {
    await expect(
      invoke('helixProfiles:orgMemberInvite', { orgId: 'org-1', email: 'a@b.com', role: 'root' })
    ).rejects.toThrow('invalid_helix_org_role')
  })

  it('rejects a role change with a blank user id', async () => {
    await expect(
      invoke('helixProfiles:orgMemberChangeRole', { orgId: 'org-1', userId: '  ', role: 'admin' })
    ).rejects.toThrow('invalid_helix_org_member_user')
  })

  it('forwards remove and revoke with validated args', async () => {
    await invoke('helixProfiles:orgMemberRemove', { orgId: 'org-1', userId: 'user-2' })
    expect(removeHelixProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/helix-user-data', {
      orgId: 'org-1',
      userId: 'user-2'
    })
    await invoke('helixProfiles:orgInviteRevoke', { orgId: 'org-1', email: 'gone@b.com' })
    expect(revokeHelixProfileOrgInviteMock).toHaveBeenCalledWith('/tmp/helix-user-data', {
      orgId: 'org-1',
      email: 'gone@b.com'
    })
  })
})
