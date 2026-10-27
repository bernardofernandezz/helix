import type { SshTarget, SshTargetOwner } from './ssh-types'

/** The runtime id phase-3 builds wrote into `owner` before the fence moved to `helixdFence`. */
const LEGACY_MANAGED_HELIXD_RUNTIME_ID_PREFIX = 'managed-helixd:'

/** The managed Helix server this host serves, or null for a direct SSH host. */
export function getManagedHelixdFenceEnvironmentId(
  target: Pick<SshTarget, 'helixdFence'> | undefined
): string | null {
  return target?.helixdFence?.environmentId || null
}

/** Reads a legacy `owner` fence, only to migrate it to `helixdFence` on load. */
export function getLegacyManagedHelixdOwnerEnvironmentId(
  owner: SshTargetOwner | undefined
): string | null {
  if (!owner?.runtimeId.startsWith(LEGACY_MANAGED_HELIXD_RUNTIME_ID_PREFIX)) {
    return null
  }
  return owner.runtimeId.slice(LEGACY_MANAGED_HELIXD_RUNTIME_ID_PREFIX.length) || null
}

export function isEphemeralRuntimeSshOwner(owner: SshTargetOwner | undefined): boolean {
  return (
    owner?.type === 'on-demand-runtime' && getLegacyManagedHelixdOwnerEnvironmentId(owner) === null
  )
}

/** Every VM a recipe makes shares its label, so the runtime id keeps their server names unique. */
export function managedHelixdServerName(target: Pick<SshTarget, 'label' | 'owner'>): string {
  const runtimeId = isEphemeralRuntimeSshOwner(target.owner) ? target.owner?.runtimeId : undefined
  return runtimeId ? `${target.label} VM ${runtimeId.slice(-8)}` : target.label
}
