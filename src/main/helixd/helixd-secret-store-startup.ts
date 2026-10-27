import { join } from 'node:path'
import { prepareHelixdSecretStore } from './helixd-host-adapters'

export async function prepareHelixdSecretStoreAndMigrate(userDataPath: string): Promise<void> {
  const { getSecretStore } = await import('../../shared/secret-store')
  const { reportSecretProtectionGap } = await import('../host/secret-protection-report')
  const { migratePlaintextCredentials, helixdCredentialRoot } =
    await import('./helixd-plaintext-credential-migration')
  // Keep sealing keys outside disposable HELIX_USER_DATA roots.
  if (await prepareHelixdSecretStore(helixdCredentialRoot(), userDataPath)) {
    migratePlaintextCredentials(getSecretStore())
  }
  reportSecretProtectionGap({ dataFile: join(userDataPath, 'helix-data.json') })
}
