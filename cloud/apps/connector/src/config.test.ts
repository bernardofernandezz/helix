import { describe, expect, it } from 'vitest'
import { loadConnectorConfig } from './config.js'

const ENV = {
  HELIX_CONNECTOR_PUBLIC_URL: 'https://connector.helix.invalid',
  HELIX_CONNECTOR_AUTH_ISSUER: 'https://login.helix.invalid',
  HELIX_CONNECTOR_JWKS_URL: 'https://login.helix.invalid/.well-known/jwks.json'
}

describe('connector config', () => {
  it('fills defaults around the required settings', () => {
    expect(loadConnectorConfig(ENV)).toEqual({
      mode: 'active',
      port: 8080,
      publicUrl: 'https://connector.helix.invalid',
      dataDir: './data/connector',
      databasePoolMax: 10,
      authIssuer: 'https://login.helix.invalid',
      jwksUrl: 'https://login.helix.invalid/.well-known/jwks.json',
      trustedProxyHops: 0
    })
  })

  it('treats a blank database URL as absent', () => {
    expect(loadConnectorConfig({ ...ENV, HELIX_CONNECTOR_DATABASE_URL: ' ' }).databaseUrl).toBe(
      undefined
    )
  })

  it.each([
    ['a path on the public URL', { HELIX_CONNECTOR_PUBLIC_URL: 'https://connector.helix.invalid/x' }],
    ['plain HTTP off loopback', { HELIX_CONNECTOR_AUTH_ISSUER: 'http://login.helix.invalid' }],
    ['a missing key set URL', { HELIX_CONNECTOR_JWKS_URL: undefined }],
    ['a plain HTTP key set URL', { HELIX_CONNECTOR_JWKS_URL: 'http://login.helix.invalid/jwks' }]
  ])('rejects %s', (_name, override) => {
    expect(() => loadConnectorConfig({ ...ENV, ...override })).toThrow()
  })

  it('allows plain HTTP on loopback for local development', () => {
    expect(
      loadConnectorConfig({ ...ENV, HELIX_CONNECTOR_PUBLIC_URL: 'http://127.0.0.1:8080' }).publicUrl
    ).toBe('http://127.0.0.1:8080')
  })
})
