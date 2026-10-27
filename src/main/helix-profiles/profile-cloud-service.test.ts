import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  HelixCloudCapabilities,
  HelixCloudOrgSummary,
  HelixProfileCloudSummary
} from '../../shared/helix-profiles'
import type { HelixCloudSessionExchangeResponse } from './profile-cloud-session-exchange'

const {
  beginHelixCloudPkceFlowMock,
  createHelixCloudProfileMock,
  exchangeHelixCloudAuthCodeMock,
  revokeHelixCloudSessionMock,
  selectHelixCloudOrgMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginHelixCloudPkceFlowMock: vi.fn(),
  createHelixCloudProfileMock: vi.fn(),
  exchangeHelixCloudAuthCodeMock: vi.fn(),
  revokeHelixCloudSessionMock: vi.fn(),
  selectHelixCloudOrgMock: vi.fn(),
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginHelixCloudPkceFlow: beginHelixCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createHelixCloudProfile: createHelixCloudProfileMock,
  exchangeHelixCloudAuthCode: exchangeHelixCloudAuthCodeMock,
  revokeHelixCloudSession: revokeHelixCloudSessionMock,
  selectHelixCloudOrg: selectHelixCloudOrgMock
}))

import {
  connectCurrentHelixProfile,
  createCloudLinkedHelixProfile,
  getCurrentHelixProfileAuthStatus,
  selectCurrentHelixProfileOrg,
  signOutCurrentHelixProfile
} from './profile-cloud-service'

const cloudSummary: HelixProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const capabilities: HelixCloudCapabilities = {
  flags: { share: true },
  refreshedAt: 11
}

const organizations: HelixCloudOrgSummary[] = [
  { orgId: 'org-1', name: 'Acme', role: 'Admin' },
  { orgId: 'org-2', name: 'Personal' }
]

function configureCloudEnv(): void {
  vi.stubEnv('HELIX_CLOUD_API_URL', 'https://helix-cloud.example')
  vi.stubEnv('HELIX_CLOUD_CLIENT_ID', 'desktop-client')
}

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function mockSuccessfulConnect(expiresAt = futureExpiresAt()): void {
  beginHelixCloudPkceFlowMock.mockResolvedValue({
    code: 'auth-code',
    codeVerifier: 'code-verifier',
    nonce: 'nonce',
    redirectUri: 'http://127.0.0.1:4100/auth/callback',
    state: 'state'
  })
  exchangeHelixCloudAuthCodeMock.mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt,
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies HelixCloudSessionExchangeResponse)
}

describe('Helix cloud profile service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'helix-cloud-service-'))
    beginHelixCloudPkceFlowMock.mockReset()
    createHelixCloudProfileMock.mockReset()
    exchangeHelixCloudAuthCodeMock.mockReset()
    revokeHelixCloudSessionMock.mockReset()
    selectHelixCloudOrgMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    revokeHelixCloudSessionMock.mockResolvedValue(undefined)
    vi.unstubAllEnvs()
    vi.stubEnv('HELIX_CLOUD_API_URL', '')
    vi.stubEnv('HELIX_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('reports local unconfigured auth without cloud setup', () => {
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    })
  })

  it('connects the active local profile without replacing its local profile ID', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()

    const result = await connectCurrentHelixProfile(userDataPath)

    if (result.status !== 'connected') {
      throw new Error(`Expected connected result, got ${result.status}`)
    }
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({
      id: 'local-default',
      kind: 'cloud-linked',
      cloud: cloudSummary
    })
    expect(exchangeHelixCloudAuthCodeMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ localProfileId: 'local-default', nonce: 'nonce' })
    )
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      persistence: 'encrypted',
      cloud: cloudSummary,
      organizations,
      capabilities
    })
  })

  it('treats provider-denied sign-in as a cancelled connect attempt', async () => {
    configureCloudEnv()
    beginHelixCloudPkceFlowMock.mockRejectedValue(new Error('helix_cloud_auth_denied'))

    const result = await connectCurrentHelixProfile(userDataPath)

    expect(result.status).toBe('cancelled')
    expect(exchangeHelixCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
  })

  it('reports callback failures as failed instead of cancelled', async () => {
    configureCloudEnv()
    beginHelixCloudPkceFlowMock.mockRejectedValue(new Error('helix_cloud_auth_callback_failed'))

    const result = await connectCurrentHelixProfile(userDataPath)

    expect(result).toMatchObject({ status: 'failed', error: 'helix_cloud_auth_callback_failed' })
    expect(exchangeHelixCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({ state: 'local' })
  })

  it('does not report a saved cloud session as connected when cloud config is unavailable', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentHelixProfile(userDataPath)
    vi.stubEnv('HELIX_CLOUD_API_URL', '')
    vi.stubEnv('HELIX_CLOUD_CLIENT_ID', '')

    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      configured: false,
      state: 'unconfigured',
      persistence: 'encrypted',
      cloud: cloudSummary,
      setupMessage: 'Helix Cloud sign-in is not configured for this build.'
    })
    expect(getCurrentHelixProfileAuthStatus(userDataPath).organizations).toBeUndefined()
    expect(getCurrentHelixProfileAuthStatus(userDataPath).capabilities).toBeUndefined()
  })

  it('signs out by removing cloud metadata while keeping the local profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentHelixProfile(userDataPath)

    const result = await signOutCurrentHelixProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({ id: 'local-default', kind: 'local' })
    expect(result.profiles[0]?.cloud).toBeUndefined()
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
    expect(revokeHelixCloudSessionMock).toHaveBeenCalledOnce()
  })

  it('creates a new empty cloud-linked profile with its own cloud session', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentHelixProfile(userDataPath)
    createHelixCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: 1000,
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities: { flags: { share: true, team: true }, refreshedAt: 13 }
    } satisfies HelixCloudSessionExchangeResponse)

    const result = await createCloudLinkedHelixProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    if (result.status !== 'created') {
      throw new Error(`Expected created result, got ${result.status}`)
    }
    expect(result.profile).toMatchObject({
      id: expect.stringMatching(/^cloud-/),
      name: 'Acme',
      kind: 'cloud-linked',
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-2' })
    })
    expect(createHelixCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('selects an organization for a connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentHelixProfile(userDataPath)
    const orgCloudSummary = {
      ...cloudSummary,
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    }
    selectHelixCloudOrgMock.mockResolvedValue({
      cloud: orgCloudSummary,
      organizations,
      capabilities: { flags: { share: true, sso: true }, refreshedAt: 12 }
    })

    const result = await selectCurrentHelixProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectHelixCloudOrgMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      'org-1'
    )
    expect(getCurrentHelixProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    })
    expect(getCurrentHelixProfileAuthStatus(userDataPath).organizations).toEqual(organizations)
  })
})
