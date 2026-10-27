import { describe, expect, it, vi } from 'vitest'
import {
  allowsPlaintextHelixCloudSession,
  getHelixCloudAuthConfig,
  isHelixCloudDevAuthEnabled
} from './profile-cloud-auth-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

describe('Helix cloud auth config', () => {
  it('reports unconfigured without both API URL and client ID', () => {
    expect(getHelixCloudAuthConfig({})).toEqual({
      configured: false,
      setupMessage: 'Helix Cloud sign-in is not configured for this build.'
    })
  })

  it('builds default desktop auth endpoints from the API URL', () => {
    const state = getHelixCloudAuthConfig({
      HELIX_CLOUD_API_URL: 'https://helix-cloud.example/',
      HELIX_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://helix-cloud.example',
        authorizeEndpoint: 'https://helix-cloud.example/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://helix-cloud.example/v1/desktop/auth/session',
        refreshEndpoint: 'https://helix-cloud.example/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://helix-cloud.example/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://helix-cloud.example/v1/desktop/auth/profile',
        orgEndpoint: 'https://helix-cloud.example/v1/desktop/auth/org',
        logoutEndpoint: 'https://helix-cloud.example/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://helix-cloud.example/v1/desktop/auth/relay-token',
        connectorTokenEndpoint: 'https://helix-cloud.example/v1/desktop/auth/connector-token',
        relayDirectorUrl: 'https://relay.helix.invalid',
        clientId: 'desktop-client',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('uses first-party production endpoints without runtime env in packaged builds', () => {
    expect(getHelixCloudAuthConfig({}, true)).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://login.helix.invalid',
        authorizeEndpoint: 'https://login.helix.invalid/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://login.helix.invalid/v1/desktop/auth/session',
        refreshEndpoint: 'https://login.helix.invalid/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://login.helix.invalid/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://login.helix.invalid/v1/desktop/auth/profile',
        orgEndpoint: 'https://login.helix.invalid/v1/desktop/auth/org',
        logoutEndpoint: 'https://login.helix.invalid/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://login.helix.invalid/v1/desktop/auth/relay-token',
        connectorTokenEndpoint: 'https://login.helix.invalid/v1/desktop/auth/connector-token',
        relayDirectorUrl: 'https://relay.helix.invalid',
        clientId: 'helix-desktop',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('allows loopback HTTP endpoints for local desktop auth development', () => {
    const state = getHelixCloudAuthConfig({
      HELIX_CLOUD_API_URL: 'http://localhost:4100',
      HELIX_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state.configured).toBe(true)
  })

  it('rejects loopback HTTP endpoints in packaged builds', () => {
    expect(
      getHelixCloudAuthConfig(
        {
          HELIX_CLOUD_API_URL: 'http://localhost:4100',
          HELIX_CLOUD_CLIENT_ID: 'desktop-client'
        },
        true
      )
    ).toMatchObject({ configured: false })

    const httpsState = getHelixCloudAuthConfig(
      {
        HELIX_CLOUD_API_URL: 'https://helix-cloud.example',
        HELIX_CLOUD_CLIENT_ID: 'desktop-client'
      },
      true
    )
    expect(httpsState.configured).toBe(true)
  })

  it('rejects non-HTTPS non-loopback API URLs', () => {
    expect(
      getHelixCloudAuthConfig({
        HELIX_CLOUD_API_URL: 'http://helix-cloud.example',
        HELIX_CLOUD_CLIENT_ID: 'desktop-client'
      })
    ).toMatchObject({ configured: false })
  })

  it('allows dev plaintext sessions only outside production', () => {
    expect(
      allowsPlaintextHelixCloudSession({
        HELIX_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      allowsPlaintextHelixCloudSession({
        HELIX_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })

  it('ignores dev flags in packaged builds even without NODE_ENV', () => {
    expect(
      allowsPlaintextHelixCloudSession({ HELIX_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)
    ).toBe(false)
    expect(isHelixCloudDevAuthEnabled({ HELIX_CLOUD_DEV_AUTH: '1' }, true)).toBe(false)
  })

  it('allows local dev auth only outside production', () => {
    expect(
      isHelixCloudDevAuthEnabled({
        HELIX_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      isHelixCloudDevAuthEnabled({
        HELIX_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })
})
