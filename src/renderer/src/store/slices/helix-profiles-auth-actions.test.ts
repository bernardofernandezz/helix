import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectCurrentHelixProfileResult,
  CreateCloudLinkedHelixProfileResult,
  HelixProfileAuthStatus,
  HelixProfileListState,
  RefreshCurrentHelixProfileAuthResult,
  SelectHelixProfileOrgResult,
  SignOutCurrentHelixProfileResult
} from '../../../../shared/helix-profiles'
import { createTestStore } from './store-test-helpers'

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    info: vi.fn(),
    success: toastSuccessMock,
    warning: vi.fn()
  }
}))

const listState: HelixProfileListState = {
  activeProfileId: 'local-default',
  profiles: [
    {
      id: 'local-default',
      name: 'Personal',
      avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
      kind: 'local',
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1
    }
  ]
}

const localAuthStatus: HelixProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: false,
  state: 'unconfigured',
  persistence: 'none'
}

const connectedCloud = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  linkedAt: 3
}

const connectedOrganizations = [
  { orgId: 'org-1', name: 'Acme', role: 'Admin' },
  { orgId: 'org-2', name: 'Personal' }
]

const connectedAuthStatus: HelixProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'connected',
  persistence: 'encrypted',
  cloud: connectedCloud,
  organizations: connectedOrganizations,
  capabilities: {
    flags: { share: true },
    refreshedAt: 4
  }
}

const helixProfilesApi = {
  list: vi.fn(),
  authStatus: vi.fn(),
  createLocal: vi.fn(),
  createCloudLinked: vi.fn(),
  connectCurrent: vi.fn(),
  refreshAuth: vi.fn(),
  signOutCurrent: vi.fn(),
  selectOrg: vi.fn(),
  switchProfile: vi.fn(),
  transferProject: vi.fn()
}

describe('helix profile auth actions slice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    toastErrorMock.mockReset()
    toastSuccessMock.mockReset()
    helixProfilesApi.authStatus.mockResolvedValue(localAuthStatus)
    vi.stubGlobal('window', {
      api: {
        helixProfiles: helixProfilesApi
      }
    })
  })

  it('connects the current profile and stores returned cloud metadata', async () => {
    const connectedProfiles = [
      {
        ...listState.profiles[0],
        kind: 'cloud-linked' as const,
        cloud: connectedAuthStatus.cloud
      }
    ]
    const result: ConnectCurrentHelixProfileResult = {
      status: 'connected',
      auth: connectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: connectedProfiles
    }
    helixProfilesApi.connectCurrent.mockResolvedValue(result)
    const store = createTestStore()

    await expect(store.getState().connectCurrentHelixProfile()).resolves.toEqual(result)
    expect(store.getState().helixProfileAuthStatus).toEqual(connectedAuthStatus)
    expect(store.getState().helixProfiles).toEqual(connectedProfiles)
    expect(toastSuccessMock).toHaveBeenCalledOnce()
  })

  it('starts a second sign-in while the first browser wait is still open', async () => {
    const connectedProfiles = [
      {
        ...listState.profiles[0],
        kind: 'cloud-linked' as const,
        cloud: connectedAuthStatus.cloud
      }
    ]
    const connected: ConnectCurrentHelixProfileResult = {
      status: 'connected',
      auth: connectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: connectedProfiles
    }
    const cancelled: ConnectCurrentHelixProfileResult = {
      status: 'cancelled',
      auth: connectedAuthStatus
    }
    let finishFirst!: (value: ConnectCurrentHelixProfileResult) => void
    helixProfilesApi.connectCurrent
      .mockReturnValueOnce(
        new Promise<ConnectCurrentHelixProfileResult>((resolve) => {
          finishFirst = resolve
        })
      )
      .mockResolvedValueOnce(connected)
    const store = createTestStore()

    const first = store.getState().connectCurrentHelixProfile()
    const second = store.getState().connectCurrentHelixProfile()

    expect(helixProfilesApi.connectCurrent).toHaveBeenCalledTimes(2)
    await expect(second).resolves.toEqual(connected)
    expect(toastSuccessMock).toHaveBeenCalledOnce()
    finishFirst(cancelled)
    await expect(first).resolves.toEqual(cancelled)
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(toastSuccessMock).toHaveBeenCalledOnce()
    expect(store.getState().helixProfileAuthStatus).toEqual(connectedAuthStatus)
  })

  it('refreshes current profile auth and stores fresh capability flags', async () => {
    const refreshedAuthStatus: HelixProfileAuthStatus = {
      ...connectedAuthStatus,
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 8
      }
    }
    const result: RefreshCurrentHelixProfileAuthResult = {
      status: 'refreshed',
      auth: refreshedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [
        {
          ...listState.profiles[0],
          kind: 'cloud-linked',
          cloud: refreshedAuthStatus.cloud
        }
      ]
    }
    helixProfilesApi.refreshAuth.mockResolvedValue(result)
    const store = createTestStore()

    await expect(store.getState().refreshCurrentHelixProfileAuth()).resolves.toEqual(result)
    expect(helixProfilesApi.refreshAuth).toHaveBeenCalledOnce()
    expect(store.getState().helixProfileAuthStatus).toEqual(refreshedAuthStatus)
    expect(store.getState().helixProfiles).toEqual(result.profiles)
  })

  it('creates a cloud-linked profile and stores the returned profile list', async () => {
    const cloudProfile = {
      id: 'cloud-acme',
      name: 'Acme',
      avatar: { kind: 'initials' as const, initials: 'A', color: 'neutral' as const },
      kind: 'cloud-linked' as const,
      createdAt: 5,
      updatedAt: 5,
      lastOpenedAt: 5,
      cloud: {
        ...connectedCloud,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      }
    }
    const result: CreateCloudLinkedHelixProfileResult = {
      status: 'created',
      auth: connectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [...listState.profiles, cloudProfile],
      profile: cloudProfile
    }
    helixProfilesApi.createCloudLinked.mockResolvedValue(result)
    const store = createTestStore()

    await expect(
      store.getState().createCloudLinkedHelixProfile({ orgId: 'org-1', name: 'Acme' })
    ).resolves.toEqual(result)
    expect(helixProfilesApi.createCloudLinked).toHaveBeenCalledWith({
      orgId: 'org-1',
      name: 'Acme'
    })
    expect(store.getState().helixProfiles).toEqual(result.profiles)
  })

  it('signs out the current profile without dropping local profile data', async () => {
    const result: SignOutCurrentHelixProfileResult = {
      status: 'signed-out',
      auth: localAuthStatus,
      activeProfileId: 'local-default',
      profiles: listState.profiles
    }
    helixProfilesApi.signOutCurrent.mockResolvedValue(result)
    const store = createTestStore()

    await expect(store.getState().signOutCurrentHelixProfile()).resolves.toEqual(result)
    expect(store.getState().helixProfileAuthStatus).toEqual(localAuthStatus)
    expect(store.getState().helixProfiles).toEqual(listState.profiles)
  })

  it('selects a cloud organization and refreshes auth state', async () => {
    const selectedAuthStatus: HelixProfileAuthStatus = {
      ...connectedAuthStatus,
      cloud: {
        ...connectedCloud,
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      }
    }
    const result: SelectHelixProfileOrgResult = {
      status: 'selected',
      auth: selectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [
        {
          ...listState.profiles[0],
          kind: 'cloud-linked',
          cloud: selectedAuthStatus.cloud
        }
      ]
    }
    helixProfilesApi.selectOrg.mockResolvedValue(result)
    const store = createTestStore()

    await expect(store.getState().selectHelixProfileOrg('org-1')).resolves.toEqual(result)
    expect(helixProfilesApi.selectOrg).toHaveBeenCalledWith({ orgId: 'org-1' })
    expect(store.getState().helixProfileAuthStatus).toEqual(selectedAuthStatus)
    expect(store.getState().helixProfileAuthStatus?.organizations).toEqual(connectedOrganizations)
  })
})
