import { HELIXD_MIGRATION_SSH_RELAY_SOURCE_KIND } from '../../shared/helixd-migration/helixd-migration-source-kind'
import type { SshTarget } from '../../shared/ssh-types'
import { collectHelixdMigrationSourceCatalog } from '../persistence/migrating-helixd-catalog/helixd-source-catalog'
import type { Store } from '../persistence'
import { createHelixdMigrationManifest } from './helixd-migration-manifest-export'
import { IDENTITY_HELIXD_MIGRATION_PATH_REWRITER } from './helixd-migration-path-rewrite'
import type {
  HelixdMigrationSource,
  HelixdMigrationSourceCutoverPort
} from './helixd-migration-source'
import { assertHelixdMigrationSourceUnchanged } from './helixd-migration-source-assertions'
import {
  fenceHelixdMigrationSource,
  releaseHelixdMigrationFence,
  resolveHelixdMigrationFence
} from './helixd-migration-source-fence'
import {
  assessHelixdMigrationTerminals,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './helixd-migration-terminal-gate'
import type { SshTargetHelixdClaims } from './targets/ssh-target-helixd-claims'
import type { HelixdMigrationPreflightStore } from './targets/ssh-target-helixd-preflight'
import type { HelixdMigrationPaneLeasePredicate } from './helixd-migration-bridged-panes'

type SshRelayCutoverDeps = {
  userDataPath: string
  store: HelixdMigrationPreflightStore
  claims: SshTargetHelixdClaims
  /** Rebuild copied stores for every check so later edits remain visible. */
  freshSource?: () => HelixdMigrationPreflightStore
  signal?: AbortSignal
}

export function sshRelayMigrationCutoverPort(
  deps: SshRelayCutoverDeps
): HelixdMigrationSourceCutoverPort {
  return {
    verifyFence: (cutover) =>
      assertHelixdMigrationSourceUnchanged(
        { userDataPath: deps.userDataPath, store: deps.freshSource?.() ?? deps.store },
        cutover
      ),
    releaseFence: (cutover) => releaseHelixdMigrationFence(deps, cutover)
  }
}

export function createSshRelayMigrationSource(
  deps: SshRelayCutoverDeps & {
    store: HelixdMigrationPreflightStore &
      Pick<Store, 'getSshRemotePtyLeases' | 'markSshRemotePtyLease'>
    target: SshTarget
    /** Every relay endpoint on the host's account; without it exit can never be proven. */
    censusHost?: CensusHostRelayTerminals | null
    isBridgedPaneLease?: HelixdMigrationPaneLeasePredicate
  }
): HelixdMigrationSource {
  const { userDataPath, store, target } = deps
  return {
    ...sshRelayMigrationCutoverPort(deps),
    kind: HELIXD_MIGRATION_SSH_RELAY_SOURCE_KIND,
    journalKey: target.id,
    collectCatalog: () => collectHelixdMigrationSourceCatalog(store, target),
    exportManifest: (options = {}) =>
      createHelixdMigrationManifest(store, target, {
        ...options,
        rewrite: IDENTITY_HELIXD_MIGRATION_PATH_REWRITER
      }),
    assessTerminals: () => assessHelixdMigrationTerminals(store, target.id, deps.censusHost),
    retireProvenExitedTerminals: (proof) => retireProvenExitedLeases(store, target.id, proof),
    resolveFence: () => resolveHelixdMigrationFence(userDataPath, target),
    acquireFence: (args) =>
      fenceHelixdMigrationSource({
        userDataPath,
        store,
        claims: deps.claims,
        targetId: target.id,
        isBridgedPaneLease: deps.isBridgedPaneLease,
        ...args
      })
  }
}
