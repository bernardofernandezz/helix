import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  beginHelixCloudPkceFlowMock,
  exchangeHelixCloudAuthCodeMock,
  revokeHelixCloudSessionMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginHelixCloudPkceFlowMock: vi.fn(),
  exchangeHelixCloudAuthCodeMock: vi.fn(),
  revokeHelixCloudSessionMock: vi.fn(),
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
  createHelixCloudProfile: vi.fn(),
  exchangeHelixCloudAuthCode: exchangeHelixCloudAuthCodeMock,
  refreshHelixCloudCapabilities: vi.fn(),
  refreshHelixCloudSession: vi.fn(),
  revokeHelixCloudSession: revokeHelixCloudSessionMock,
  selectHelixCloudOrg: vi.fn()
}))

import {
  connectCurrentHelixProfile,
  createCloudLinkedHelixProfile,
  getCurrentHelixProfileAuthStatus,
  selectCurrentHelixProfileOrg,
  signOutCurrentHelixProfile
} from './profile-cloud-service'

describe('Helix cloud dev auth service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'helix-cloud-dev-auth-'))
    beginHelixCloudPkceFlowMock.mockReset()
    exchangeHelixCloudAuthCodeMock.mockReset()
    revokeHelixCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('HELIX_CLOUD_DEV_AUTH', '1')
    vi.stubEnv('HELIX_CLOUD_API_URL', '')
    vi.stubEnv('HELIX_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('connects the active profile without PKCE or cloud endpoints', async () => {
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local'
    })

    const result = await connectCurrentHelixProfile(userDataPath)

    expect(result.status).toBe('connected')
    expect(beginHelixCloudPkceFlowMock).not.toHaveBeenCalled()
    expect(exchangeHelixCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'connected',
      persistence: 'encrypted',
      cloud: {
        cloudProfileId: 'dev-cloud-local-default',
        email: 'dev@helix.local'
      },
      capabilities: {
        flags: expect.objectContaining({ 'share.create': true })
      }
    })
    expect(getCurrentHelixProfileAuthStatus(userDataPath).organizations).toHaveLength(2)
  })

  it('selects dev organizations and creates org-scoped cloud profiles locally', async () => {
    await connectCurrentHelixProfile(userDataPath)

    const selected = await selectCurrentHelixProfileOrg(userDataPath, 'dev-acme')
    const created = await createCloudLinkedHelixProfile(userDataPath, {
      orgId: 'dev-acme',
      name: 'Acme Dev'
    })

    expect(selected.status).toBe('selected')
    expect(getCurrentHelixProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'dev-acme',
      activeOrgName: 'Acme Dev'
    })
    expect(created.status).toBe('created')
    if (created.status === 'created') {
      expect(created.profile).toMatchObject({
        name: 'Acme Dev',
        kind: 'cloud-linked',
        cloud: expect.objectContaining({
          activeOrgId: 'dev-acme',
          activeOrgName: 'Acme Dev'
        })
      })
    }
  })

  it('signs out locally without calling the cloud logout endpoint', async () => {
    await connectCurrentHelixProfile(userDataPath)
    const regionCache = join(userDataPath, 'helix-relay-region-preference.json')
    writeFileSync(regionCache, '{}')

    const result = await signOutCurrentHelixProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(existsSync(regionCache)).toBe(false)
    expect(revokeHelixCloudSessionMock).not.toHaveBeenCalled()
    expect(getCurrentHelixProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local',
      persistence: 'none'
    })
  })
})
