// In-place WSL moves require the desktop-launched helixd in the source distro to own the unchanged paths.
import type { HelixdMigrationManifestSource } from '../../shared/helixd-migration/helixd-migration-manifest'
import { isHelixdMigrationLocalWslSource } from '../../shared/helixd-migration/helixd-migration-source-kind'
import { isWslHostHelixdProcess } from '../ipc/wsl-guest-windows-drive-path'

export const HELIXD_MIGRATION_SOURCE_NOT_THIS_HOST = 'helixd_migration_source_not_this_host'

/** Desktop-provided registry ID; guests cannot read it themselves. */
export const HELIXD_WSL_DISTRO_GUID_ENV = 'HELIX_WSL_DISTRO_GUID'

export function servesLocalWslMigrationSource(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  return isWslHostHelixdProcess(env, platform)
}

export function assertHelixdMigrationSourceServedHere(
  source: HelixdMigrationManifestSource,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (!isHelixdMigrationLocalWslSource(source)) {
    return
  }
  // WSL distro names and their UNC forms are case-insensitive.
  const distro = env.WSL_DISTRO_NAME?.trim().toLowerCase()
  if (!servesLocalWslMigrationSource(env, platform) || distro !== source.distro.toLowerCase()) {
    throw new Error(HELIXD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
  // Re-registering a distro reuses its name, not its files; require its registry ID when supplied.
  const guid = env[HELIXD_WSL_DISTRO_GUID_ENV]?.trim().toLowerCase()
  if (source.distroGuid !== undefined && guid !== source.distroGuid.toLowerCase()) {
    throw new Error(HELIXD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
}
