import { HelixdBindAddressError } from './helixd-bind-address'
import { HelixdBundledRuntimeError } from './helixd-bundled-runtime'
import { HelixdInstanceLockError } from './helixd-data-root-privacy'
import { ProfileStateAccessError } from '../persistence/profile-state/profile-state-access'
import { HELIXD_EXIT_CONFIGURATION } from './helixd-configuration-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'

export const HELIXD_EXIT_FAILED = 1

export function resolveHelixdExitCode(error: unknown): number {
  // Supervisors wait for an existing holder instead of abandoning the host.
  if (
    error instanceof HelixdInstanceLockError &&
    error.code === 'helixd_instance_lock_holder_unverifiable'
  ) {
    return SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
  }
  return error instanceof HelixdInstanceLockError ||
    error instanceof HelixdBindAddressError ||
    error instanceof HelixdBundledRuntimeError ||
    error instanceof ProfileStateAccessError
    ? HELIXD_EXIT_CONFIGURATION
    : HELIXD_EXIT_FAILED
}
