// Always report available to prevent plaintext fallback; throw on seal/unseal when the key is unavailable.
import type { SecretStore } from '../../shared/secret-store'
import { sweepStaleRecordStaging } from './helixd-secret-key-record'
import {
  helixdSecretStatePath,
  resolveState,
  type HelixdSecretStorePrepareOptions,
  type StoreState
} from './helixd-secret-key-resolution'
import { openHelixdSecret, sealHelixdSecret } from './helixd-secret-sealing'

export type HelixdSecretStore = SecretStore & {
  prepare(options: HelixdSecretStorePrepareOptions): Promise<boolean>
}

export function createHelixdSecretStore(
  log: (message: string) => void = (message) => console.warn(message)
): HelixdSecretStore {
  let state: StoreState = { kind: 'pending' }
  const readyKey = (): Buffer => {
    if (state.kind === 'ready') {
      return state.key
    }
    throw new Error(
      state.kind === 'unavailable'
        ? state.message
        : 'helixd_secret_store_not_prepared — the headless secret store has not loaded its key yet'
    )
  }
  return {
    isEncryptionAvailable: () => state.kind !== 'plaintext',
    encryptString: (plainText) => sealHelixdSecret(readyKey(), plainText),
    decryptString: (cipher) => openHelixdSecret(readyKey(), cipher),
    describeProtectionGap: () => {
      switch (state.kind) {
        case 'ready':
          return state.gap
        case 'unavailable':
          return state.message
        case 'plaintext':
          return state.reason
        case 'pending':
          return "Helix's headless server has not loaded its credential key yet."
      }
    },
    async prepare(next) {
      sweepStaleRecordStaging(helixdSecretStatePath(next))
      state = await resolveState(next, log)
      return state.kind === 'ready'
    }
  }
}
