import { describe, expect, it } from 'vitest'
import type { HelixdMigrationManifestSource } from '../../shared/helixd-migration/helixd-migration-manifest'
import {
  assertHelixdMigrationSourceServedHere,
  HELIXD_MIGRATION_SOURCE_NOT_THIS_HOST,
  servesLocalWslMigrationSource
} from './helixd-migration-wsl-destination'

const WSL_SOURCE: HelixdMigrationManifestSource = {
  kind: 'local-wsl',
  distro: 'Ubuntu',
  scopeRepoIds: ['repo-1'],
  scopeFolderWorkspaceIds: [],
  generation: 1
}
const SSH_SOURCE: HelixdMigrationManifestSource = {
  sshTargetId: 'ssh-1',
  sshTargetGeneration: 1,
  targetLabel: 'Prod'
}
const WSL_HOST = { HELIX_WSL_HELIXD_HOST: '1', WSL_DISTRO_NAME: 'ubuntu' }

describe('WSL migration destination', () => {
  it('serves the WSL source only on the helixd Helix launched inside a distro', () => {
    expect(servesLocalWslMigrationSource(WSL_HOST, 'linux')).toBe(true)
    // WSLg and SSH guests lack the desktop-launched WSL host identity.
    expect(servesLocalWslMigrationSource({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux')).toBe(false)
    expect(servesLocalWslMigrationSource(WSL_HOST, 'win32')).toBe(false)
  })

  it('accepts its own distro, case-insensitively', () => {
    expect(() => assertHelixdMigrationSourceServedHere(WSL_SOURCE, WSL_HOST, 'linux')).not.toThrow()
  })

  it.each([
    ['another distro', { ...WSL_HOST, WSL_DISTRO_NAME: 'Debian' }, 'linux'],
    ['a plain Linux host', {}, 'linux'],
    ['a desktop', WSL_HOST, 'darwin']
  ] as const)('refuses a WSL source on %s', (_label, env, platform) => {
    expect(() => assertHelixdMigrationSourceServedHere(WSL_SOURCE, env, platform)).toThrow(
      HELIXD_MIGRATION_SOURCE_NOT_THIS_HOST
    )
  })

  it('refuses a source from another registration of the same distro name', () => {
    const source = { ...WSL_SOURCE, distroGuid: '{AAAA}' }
    expect(() =>
      assertHelixdMigrationSourceServedHere(
        source,
        { ...WSL_HOST, HELIX_WSL_DISTRO_GUID: '{aaaa}' },
        'linux'
      )
    ).not.toThrow()
    for (const env of [{ ...WSL_HOST, HELIX_WSL_DISTRO_GUID: '{BBBB}' }, WSL_HOST]) {
      expect(() => assertHelixdMigrationSourceServedHere(source, env, 'linux')).toThrow(
        HELIXD_MIGRATION_SOURCE_NOT_THIS_HOST
      )
    }
  })

  it('leaves the SSH conversion alone everywhere', () => {
    expect(() => assertHelixdMigrationSourceServedHere(SSH_SOURCE, {}, 'linux')).not.toThrow()
  })
})
