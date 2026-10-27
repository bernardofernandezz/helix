/** Legacy SSH omits source.kind to preserve signed bytes/digests. Other kinds must set kind and omit sshTargetId:
 * older destinations strip unknown fields, then fail parsing instead of importing a non-SSH source as SSH. */
import type {
  HelixdMigrationLocalWslManifestSource,
  HelixdMigrationManifestSource,
  HelixdMigrationSshManifestSource
} from './helixd-migration-manifest'
import { HELIXD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY } from '../helixd-runtime-capabilities'

export const HELIXD_MIGRATION_SSH_RELAY_SOURCE_KIND = 'ssh-relay' as const

/** Non-SSH kinds and the destination capability that proves a destination parses each one. */
export const HELIXD_MIGRATION_SOURCE_KIND_CAPABILITIES = {
  'local-wsl': HELIXD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
} as const

export type HelixdMigrationNonSshSourceKind = keyof typeof HELIXD_MIGRATION_SOURCE_KIND_CAPABILITIES
export type HelixdMigrationSourceKind =
  | typeof HELIXD_MIGRATION_SSH_RELAY_SOURCE_KIND
  | HelixdMigrationNonSshSourceKind

export const HELIXD_MIGRATION_SOURCE_KIND_UNKNOWN = 'helixd_migration_source_kind_unknown'

/** A manifest source as it travels: this build may not know every field a newer peer signed. */
export type HelixdMigrationWireSource = Readonly<Record<string, unknown>>

export function helixdMigrationManifestSourceKind(
  source: HelixdMigrationWireSource
): HelixdMigrationSourceKind {
  if (source.kind === undefined) {
    return HELIXD_MIGRATION_SSH_RELAY_SOURCE_KIND
  }
  // An explicit 'ssh-relay' is refused too: SSH has exactly one encoding, so one digest.
  if (isNonSshSourceKind(source.kind)) {
    return source.kind
  }
  throw new Error(HELIXD_MIGRATION_SOURCE_KIND_UNKNOWN)
}

function isNonSshSourceKind(kind: unknown): kind is HelixdMigrationNonSshSourceKind {
  return typeof kind === 'string' && Object.hasOwn(HELIXD_MIGRATION_SOURCE_KIND_CAPABILITIES, kind)
}

/** The capability a destination must advertise before it may see this source; null for SSH. */
export function requiredHelixdMigrationSourceCapability(
  source: HelixdMigrationWireSource
): string | null {
  const kind = helixdMigrationManifestSourceKind(source)
  return kind === HELIXD_MIGRATION_SSH_RELAY_SOURCE_KIND
    ? null
    : HELIXD_MIGRATION_SOURCE_KIND_CAPABILITIES[kind]
}

export function isHelixdMigrationLocalWslSource(
  source: HelixdMigrationManifestSource
): source is HelixdMigrationLocalWslManifestSource {
  return 'kind' in source && source.kind === 'local-wsl'
}

/** For the SSH conversion's own steps: a WSL manifest reaching them is a bug, never a fallback. */
export function requireHelixdMigrationSshSource(
  source: HelixdMigrationManifestSource
): HelixdMigrationSshManifestSource {
  if (isHelixdMigrationLocalWslSource(source)) {
    throw new Error('helixd_migration_source_not_ssh')
  }
  return source
}
