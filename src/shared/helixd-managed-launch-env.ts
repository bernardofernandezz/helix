/** Managed launches alone enable idle exit and name the activation fence that keeps updates/rollbacks alive.
 * Dependency-free so the helixd launcher can read it. */
export const HELIXD_MANAGED_ACTIVATION_ROOT_ENV = 'HELIX_HELIXD_MANAGED_ACTIVATION_ROOT'

/** Host login env naming a machine's own managed-server data on a shared home; clones copy /etc/machine-id. */
export const HELIX_MACHINE_NAME_ENV = 'HELIX_MACHINE_NAME'
