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
  refreshHelixCloudCapabilitiesMock,
  refreshHelixCloudSessionMock,
  HelixCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginHelixCloudPkceFlowMock: vi.fn(),
  createHelixCloudProfileMock: vi.fn(),
  exchangeHelixCloudAuthCodeMock: vi.fn(),
  refreshHelixCloudCapabilitiesMock: vi.fn(),
  refreshHelixCloudSessionMock: vi.fn(),
  HelixCloudRequestErrorMock: class HelixCloudRequestError extends Error {
    constructor(public readonly statusCode: number) {
      super(`helix_cloud_request_failed_${statusCode}`)
      this.name = 'HelixCloudRequestError'
    }
  },
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
  HelixCloudRequestError: HelixCloudRequestErrorMock,
  isAmbiguousCloudRequestFailure: (error: unknown) =>
    !(error instanceof HelixCloudRequestErrorMock),
  createHelixCloudProfile: createHelixCloudProfileMock,
  exchangeHelixCloudAuthCode: exchangeHelixCloudAuthCodeMock,
  refreshHelixCloudCapabilities: refreshHelixCloudCapabilitiesMock,
  refreshHelixCloudSession: refreshHelixCloudSessionMock,
  revokeHelixCloudSession: vi.fn(),
  selectHelixCloudOrg: vi.fn()
}))

import {
  connectCurrentHelixProfile,
  createCloudLinkedHelixProfile,
  getCurrentHelixProfileAuthStatus,
  refreshCurrentHelixProfileAuth
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

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function configureCloudEnv(): void {
  vi.stubEnv('HELIX_CLOUD_API_URL', 'https://helix-cloud.example')
  vi.stubEnv('HELIX_CLOUD_CLIENT_ID', 'desktop-client')
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

describe('Helix cloud profile service session refresh', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'helix-cloud-service-refresh-'))
    beginHelixCloudPkceFlowMock.mockReset()
    createHelixCloudProfileMock.mockReset()
    exchangeHelixCloudAuthCodeMock.mockReset()
    refreshHelixCloudCapabilitiesMock.mockReset()
    refreshHelixCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('HELIX_CLOUD_API_URL', '')
    vi.stubEnv('HELIX_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('refreshes an expired access token before creating cloud profiles', async () => {
    configureCloudEnv()
    mockSuccessfulConnect(Date.now() - 1_000)
    await connectCurrentHelixProfile(userDataPath)
    refreshHelixCloudSessionMock.mockResolvedValue({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: cloudSummary,
      organizations,
      capabilities
    } satisfies HelixCloudSessionExchangeResponse)
    createHelixCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities
    } satisfies HelixCloudSessionExchangeResponse)

    const result = await createCloudLinkedHelixProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    expect(result.status).toBe('created')
    expect(refreshHelixCloudSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ refreshToken: 'refresh-token' })
    )
    expect(createHelixCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('refreshes capability flags for the connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentHelixProfile(userDataPath)
    refreshHelixCloudCapabilitiesMock.mockResolvedValue({
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 25
      }
    })

    const result = await refreshCurrentHelixProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshHelixCloudCapabilitiesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' })
    )
    expect(getCurrentHelixProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false, team: true },
      refreshedAt: 25
    })
  })

  it('clears stale active org metadata when capability refresh returns no active org', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    exchangeHelixCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
      organizations,
      capabilities
    } satisfies HelixCloudSessionExchangeResponse)
    await connectCurrentHelixProfile(userDataPath)
    refreshHelixCloudCapabilitiesMock.mockResolvedValue({
      cloud: cloudSummary,
      organizations: [],
      capabilities: {
        flags: { share: false },
        refreshedAt: 31
      }
    })

    const result = await refreshCurrentHelixProfileAuth(userDataPath)
    const status = getCurrentHelixProfileAuthStatus(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(status.cloud?.activeOrgId).toBeUndefined()
    expect(status.cloud?.activeOrgName).toBeUndefined()
    expect(status.organizations).toEqual([])
    expect(status.capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 31
    })
  })

  it('requires reconnect when an expired refresh token is rejected', async () => {
    configureCloudEnv()
    mockSuccessfulConnect(Date.now() - 1_000)
    await connectCurrentHelixProfile(userDataPath)
    refreshHelixCloudSessionMock.mockRejectedValue(new HelixCloudRequestErrorMock(401))

    const result = await refreshCurrentHelixProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })
})
