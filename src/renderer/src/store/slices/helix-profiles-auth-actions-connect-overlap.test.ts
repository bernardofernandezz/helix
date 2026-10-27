import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectCurrentHelixProfileResult,
  HelixProfileAuthStatus,
  HelixProfileListState,
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

const connectedCloud = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  linkedAt: 3
}

const connectedAuthStatus: HelixProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'connected',
  persistence: 'encrypted',
  cloud: connectedCloud,
  organizations: [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }],
  capabilities: { flags: { share: true }, refreshedAt: 4 }
}

const helixProfilesApi = {
  connectCurrent: vi.fn(),
  signOutCurrent: vi.fn()
}

describe('helix profile overlapping connect actions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    toastErrorMock.mockReset()
    toastSuccessMock.mockReset()
    vi.stubGlobal('window', {
      api: { helixProfiles: helixProfilesApi }
    })
  })

  it('keeps the later sign-in and one success toast when both waits complete', async () => {
    const laterCloud = { ...connectedCloud, userId: 'user-2', email: 'ada@example.com' }
    const laterAuthStatus: HelixProfileAuthStatus = {
      ...connectedAuthStatus,
      cloud: laterCloud
    }
    const earlierConnected: ConnectCurrentHelixProfileResult = {
      status: 'connected',
      auth: connectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [{ ...listState.profiles[0], kind: 'cloud-linked', cloud: connectedCloud }]
    }
    const laterConnected: ConnectCurrentHelixProfileResult = {
      status: 'connected',
      auth: laterAuthStatus,
      activeProfileId: 'local-default',
      profiles: [{ ...listState.profiles[0], kind: 'cloud-linked', cloud: laterCloud }]
    }
    let finishFirst!: (value: ConnectCurrentHelixProfileResult) => void
    helixProfilesApi.connectCurrent
      .mockReturnValueOnce(
        new Promise<ConnectCurrentHelixProfileResult>((resolve) => {
          finishFirst = resolve
        })
      )
      .mockResolvedValueOnce(laterConnected)
    const store = createTestStore()

    const first = store.getState().connectCurrentHelixProfile()
    const second = store.getState().connectCurrentHelixProfile()
    await expect(second).resolves.toEqual(laterConnected)
    finishFirst(earlierConnected)
    await expect(first).resolves.toEqual(earlierConnected)
    expect(toastSuccessMock).toHaveBeenCalledOnce()
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(store.getState().helixProfileAuthStatus).toEqual(laterAuthStatus)
    expect(store.getState().helixProfiles).toEqual(laterConnected.profiles)
  })

  it('ignores an in-flight later connect after sign-out', async () => {
    const signedOutAuth: HelixProfileAuthStatus = {
      activeProfileId: 'local-default',
      configured: true,
      state: 'local',
      persistence: 'none'
    }
    const signedOut: SignOutCurrentHelixProfileResult = {
      status: 'signed-out',
      auth: signedOutAuth,
      activeProfileId: 'local-default',
      profiles: listState.profiles
    }
    const earlierConnected: ConnectCurrentHelixProfileResult = {
      status: 'connected',
      auth: connectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [{ ...listState.profiles[0], kind: 'cloud-linked', cloud: connectedCloud }]
    }
    const laterConnected: ConnectCurrentHelixProfileResult = {
      status: 'connected',
      auth: {
        ...connectedAuthStatus,
        cloud: { ...connectedCloud, userId: 'user-2', email: 'ada@example.com' }
      },
      activeProfileId: 'local-default',
      profiles: [
        {
          ...listState.profiles[0],
          kind: 'cloud-linked',
          cloud: { ...connectedCloud, userId: 'user-2', email: 'ada@example.com' }
        }
      ]
    }
    let finishLater!: (value: ConnectCurrentHelixProfileResult) => void
    helixProfilesApi.connectCurrent.mockResolvedValueOnce(earlierConnected).mockReturnValueOnce(
      new Promise<ConnectCurrentHelixProfileResult>((resolve) => {
        finishLater = resolve
      })
    )
    helixProfilesApi.signOutCurrent.mockResolvedValue(signedOut)
    const store = createTestStore()

    const earlier = store.getState().connectCurrentHelixProfile()
    const later = store.getState().connectCurrentHelixProfile()
    await expect(earlier).resolves.toEqual(earlierConnected)
    await expect(store.getState().signOutCurrentHelixProfile()).resolves.toEqual(signedOut)
    finishLater(laterConnected)
    await expect(later).resolves.toEqual(laterConnected)
    expect(store.getState().helixProfileAuthStatus).toEqual(signedOutAuth)
    expect(store.getState().helixProfiles).toEqual(listState.profiles)
  })

  it('does not toast signed out when sign-out returns an already-relinked session', async () => {
    const signedOut: SignOutCurrentHelixProfileResult = {
      status: 'signed-out',
      auth: connectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [{ ...listState.profiles[0], kind: 'cloud-linked', cloud: connectedCloud }]
    }
    helixProfilesApi.signOutCurrent.mockResolvedValue(signedOut)
    const store = createTestStore()

    await expect(store.getState().signOutCurrentHelixProfile()).resolves.toEqual(signedOut)
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(store.getState().helixProfileAuthStatus).toEqual(connectedAuthStatus)
  })
})
