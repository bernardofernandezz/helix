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
  selectHelixCloudOrgMock,
  HelixCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginHelixCloudPkceFlowMock: vi.fn(),
  createHelixCloudProfileMock: vi.fn(),
  exchangeHelixCloudAuthCodeMock: vi.fn(),
  refreshHelixCloudCapabilitiesMock: vi.fn(),
  refreshHelixCloudSessionMock: vi.fn(),
  selectHelixCloudOrgMock: vi.fn(),
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
  selectHelixCloudOrg: selectHelixCloudOrgMock
}))

import {
  connectCurrentHelixProfile,
  createCloudLinkedHelixProfile,
  getCurrentHelixProfileAuthStatus,
  refreshCurrentHelixProfileAuth,
  selectCurrentHelixProfileOrg
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

function mockSuccessfulConnect(): void {
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
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies HelixCloudSessionExchangeResponse)
}

function mockSuccessfulSessionRefresh(): void {
  refreshHelixCloudSessionMock.mockResolvedValue({
    accessToken: 'rotated-access-token',
    refreshToken: 'rotated-refresh-token',
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies HelixCloudSessionExchangeResponse)
}

describe('Helix cloud profile auth-failure retry', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'helix-cloud-service-auth-retry-'))
    beginHelixCloudPkceFlowMock.mockReset()
    createHelixCloudProfileMock.mockReset()
    exchangeHelixCloudAuthCodeMock.mockReset()
    refreshHelixCloudCapabilitiesMock.mockReset()
    refreshHelixCloudSessionMock.mockReset()
    selectHelixCloudOrgMock.mockReset()
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

  it('refreshes and retries cloud profile creation after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentHelixProfile(userDataPath)
    createHelixCloudProfileMock
      .mockRejectedValueOnce(new HelixCloudRequestErrorMock(401))
      .mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: futureExpiresAt(),
        cloud: { ...cloudSummary, cloudProfileId: 'cloud-profile-2' },
        organizations,
        capabilities
      } satisfies HelixCloudSessionExchangeResponse)

    const result = await createCloudLinkedHelixProfile(userDataPath, { name: 'Acme' })

    expect(result.status).toBe('created')
    expect(createHelixCloudProfileMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { name: 'Acme' }
    )
  })

  it('refreshes and retries capability refresh after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentHelixProfile(userDataPath)
    refreshHelixCloudCapabilitiesMock
      .mockRejectedValueOnce(new HelixCloudRequestErrorMock(403))
      .mockResolvedValue({
        capabilities: { flags: { share: false }, refreshedAt: 26 } satisfies HelixCloudCapabilities
      })

    const result = await refreshCurrentHelixProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshHelixCloudCapabilitiesMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' })
    )
    expect(getCurrentHelixProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 26
    })
  })

  it('requires reconnect when a retried capability refresh is still unauthorized', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentHelixProfile(userDataPath)
    refreshHelixCloudCapabilitiesMock
      .mockRejectedValueOnce(new HelixCloudRequestErrorMock(401))
      .mockRejectedValueOnce(new HelixCloudRequestErrorMock(401))

    const result = await refreshCurrentHelixProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })

  it('refreshes and retries organization selection after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentHelixProfile(userDataPath)
    selectHelixCloudOrgMock
      .mockRejectedValueOnce(new HelixCloudRequestErrorMock(401))
      .mockResolvedValue({
        cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
        organizations,
        capabilities
      })

    const result = await selectCurrentHelixProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectHelixCloudOrgMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      'org-1'
    )
  })
})
