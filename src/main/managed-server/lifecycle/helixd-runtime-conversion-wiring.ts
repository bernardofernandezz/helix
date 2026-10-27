import { encodePairingOffer } from '../../../shared/pairing'
import {
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { disconnectRegisteredSshTarget } from '../../ipc/ssh/ssh-session-teardown'
import type { HelixdMigrationDestinationCatalog } from '../../ssh/helixd-migration-cutover-coordinator'
import {
  abortRemoteHelixdMigrationCatalog,
  commitRemoteHelixdMigrationCatalog,
  listRemoteHelixdRepositories,
  readRemoteHelixdMigrationCatalogState,
  stageRemoteHelixdMigrationCatalog,
  stageRemoteHelixdMigrationSnapshotChunk
} from '../../ssh/helixd-migration-catalog-client'
import { abortRemoteHelixdMigrationCatalogByReference } from '../../ssh/helixd-migration-catalog-reference-client'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { isBridgeableLease } from '../../ssh/legacy-relay/legacy-relay-bridge-leases'
import type { HelixdManagedConversionArgs } from './helixd-runtime-conversion'
import type { HelixdServerRepository } from '../../ssh/helixd-migration-repository-link'
import {
  listRemoteHelixdFolderCatalog,
  type HelixdServerFolderCatalog
} from '../../ssh/helixd-server-folder-workspaces'

export function helixdMigrationDestinationFor(
  environment: KnownRuntimeEnvironment
): HelixdMigrationDestinationCatalog {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return {
    readState: (manifest) => readRemoteHelixdMigrationCatalogState(pairingCode, manifest, options),
    stage: (manifest) => stageRemoteHelixdMigrationCatalog(pairingCode, manifest, options),
    commit: (manifest) => commitRemoteHelixdMigrationCatalog(pairingCode, manifest, options),
    abort: (manifest) => abortRemoteHelixdMigrationCatalog(pairingCode, manifest, options),
    abortByReference: (manifest) =>
      abortRemoteHelixdMigrationCatalogByReference(pairingCode, manifest, options),
    stageChunk: (request) => stageRemoteHelixdMigrationSnapshotChunk(pairingCode, request, options)
  }
}

export function helixdServerRepositoriesFor(
  environment: KnownRuntimeEnvironment
): Promise<HelixdServerRepository[]> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteHelixdRepositories(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function helixdServerFolderCatalogFor(
  environment: KnownRuntimeEnvironment
): Promise<HelixdServerFolderCatalog> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteHelixdFolderCatalog(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function conversionCollaborators(): Pick<
  HelixdManagedConversionArgs,
  | 'destinationFor'
  | 'serverRepositoriesFor'
  | 'serverFolderCatalogFor'
  | 'censusHost'
  | 'isBridgedPaneLease'
  | 'releaseDirectSession'
> {
  return {
    destinationFor: helixdMigrationDestinationFor,
    serverRepositoriesFor: helixdServerRepositoriesFor,
    serverFolderCatalogFor: helixdServerFolderCatalogFor,
    censusHost: (target) => censusHostRelayTerminalsFor(target)(),
    isBridgedPaneLease: isBridgeableLease,
    releaseDirectSession: disconnectRegisteredSshTarget
  }
}
