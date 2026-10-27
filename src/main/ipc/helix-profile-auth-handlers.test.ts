import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  createCloudLinkedHelixProfileMock,
  connectCurrentHelixProfileMock,
  getCurrentHelixProfileAuthStatusMock,
  refreshCurrentHelixProfileAuthMock,
  selectCurrentHelixProfileOrgMock,
  signOutCurrentHelixProfileMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  createCloudLinkedHelixProfileMock: vi.fn(),
  connectCurrentHelixProfileMock: vi.fn(),
  getCurrentHelixProfileAuthStatusMock: vi.fn(),
  refreshCurrentHelixProfileAuthMock: vi.fn(),
  selectCurrentHelixProfileOrgMock: vi.fn(),
  signOutCurrentHelixProfileMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    relaunch: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../tray/system-tray', () => ({
  destroySystemTray: vi.fn()
}))

vi.mock('../helix-profiles/profile-index-store', () => ({
  createLocalHelixProfile: vi.fn(),
  getHelixProfileListState: vi.fn(),
  seedNewHelixProfileTelemetryConsent: vi.fn(),
  setActiveHelixProfile: vi.fn()
}))

vi.mock('../helix-profiles/profile-project-transfer', () => ({
  transferHelixProfileProject: vi.fn()
}))

vi.mock('../helix-profiles/profile-cloud-service', () => ({
  createCloudLinkedHelixProfile: createCloudLinkedHelixProfileMock,
  connectCurrentHelixProfile: connectCurrentHelixProfileMock,
  getCurrentHelixProfileAuthStatus: getCurrentHelixProfileAuthStatusMock,
  refreshCurrentHelixProfileAuth: refreshCurrentHelixProfileAuthMock,
  selectCurrentHelixProfileOrg: selectCurrentHelixProfileOrgMock,
  signOutCurrentHelixProfile: signOutCurrentHelixProfileMock
}))

import { registerHelixProfileHandlers } from './helix-profiles'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

describe('registerHelixProfileHandlers auth channels', () => {
  beforeEach(() => {
    // Reinstall AppEnvironment per test after global beforeEach resets its fake.
    installFakeAppEnvironment({ getPath: () => '/tmp/helix-user-data' })
    handlers.clear()
    createCloudLinkedHelixProfileMock.mockReset()
    connectCurrentHelixProfileMock.mockReset()
    getCurrentHelixProfileAuthStatusMock.mockReset()
    refreshCurrentHelixProfileAuthMock.mockReset()
    selectCurrentHelixProfileOrgMock.mockReset()
    signOutCurrentHelixProfileMock.mockReset()
  })

  it('returns auth status for the current profile', async () => {
    const status = {
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    }
    getCurrentHelixProfileAuthStatusMock.mockReturnValue(status)
    registerHelixProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('helixProfiles:authStatus')?.(null))).resolves.toBe(
      status
    )
    expect(getCurrentHelixProfileAuthStatusMock).toHaveBeenCalledWith('/tmp/helix-user-data')
  })

  it('connects and signs out the current profile through the cloud service', async () => {
    const connectResult = { status: 'unconfigured', auth: { activeProfileId: 'local-default' } }
    const signOutResult = { status: 'signed-out', auth: { activeProfileId: 'local-default' } }
    connectCurrentHelixProfileMock.mockResolvedValue(connectResult)
    signOutCurrentHelixProfileMock.mockResolvedValue(signOutResult)
    registerHelixProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('helixProfiles:connectCurrent')?.(null))
    ).resolves.toBe(connectResult)
    await expect(
      Promise.resolve(handlers.get('helixProfiles:signOutCurrent')?.(null))
    ).resolves.toBe(signOutResult)
    expect(connectCurrentHelixProfileMock).toHaveBeenCalledWith('/tmp/helix-user-data')
    expect(signOutCurrentHelixProfileMock).toHaveBeenCalledWith('/tmp/helix-user-data')
  })

  it('refreshes profile auth through the cloud service', async () => {
    const refreshResult = { status: 'refreshed', auth: { activeProfileId: 'local-default' } }
    refreshCurrentHelixProfileAuthMock.mockResolvedValue(refreshResult)
    registerHelixProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('helixProfiles:refreshAuth')?.(null))).resolves.toBe(
      refreshResult
    )
    expect(refreshCurrentHelixProfileAuthMock).toHaveBeenCalledWith('/tmp/helix-user-data')
  })

  it('validates organization selection before calling the cloud service', async () => {
    const selectResult = { status: 'selected', auth: { activeProfileId: 'local-default' } }
    selectCurrentHelixProfileOrgMock.mockResolvedValue(selectResult)
    registerHelixProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('helixProfiles:selectOrg')?.(null, { orgId: ' org-1 ' }))
    ).resolves.toBe(selectResult)
    expect(selectCurrentHelixProfileOrgMock).toHaveBeenCalledWith('/tmp/helix-user-data', 'org-1')

    await expect(
      Promise.resolve(handlers.get('helixProfiles:selectOrg')?.(null, { orgId: ' ' }))
    ).rejects.toThrow('invalid_helix_profile_org_selection')
  })

  it('creates cloud-linked profiles with trimmed optional args', async () => {
    const createResult = {
      status: 'created',
      auth: { activeProfileId: 'local-default' },
      activeProfileId: 'local-default',
      profiles: [],
      profile: { id: 'cloud-1' }
    }
    createCloudLinkedHelixProfileMock.mockResolvedValue(createResult)
    registerHelixProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(
        handlers.get('helixProfiles:createCloudLinked')?.(null, {
          orgId: ' org-1 ',
          name: ' Acme '
        })
      )
    ).resolves.toBe(createResult)
    expect(createCloudLinkedHelixProfileMock).toHaveBeenCalledWith('/tmp/helix-user-data', {
      orgId: 'org-1',
      name: 'Acme'
    })
  })
})
