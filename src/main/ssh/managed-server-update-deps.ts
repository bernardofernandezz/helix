import { getAppEnvironment } from '../../shared/app-environment'
import type { ManagedServerUpdateDeps } from './managed-server-update-check'
import { autoUpdateManagedHelixdEnvironment } from '../managed-server/lifecycle/helixd-managed-auto-update'
import { requireManagedHelixdTargetStore } from '../managed-server/lifecycle/helixd-managed-runtime-context'
import {
  helixdUpdateFailedThisLaunch,
  recordHelixdUpdateFailedThisLaunch
} from '../managed-server/lifecycle/helixd-managed-update-failure-memory'

export function managedServerUpdateDeps(userDataPath: string): ManagedServerUpdateDeps {
  const registry = requireManagedHelixdTargetStore()
  const appVersion = getAppEnvironment().getVersion()
  return {
    autoUpdate: (environmentId, options) =>
      autoUpdateManagedHelixdEnvironment(userDataPath, { environmentId, appVersion, ...options }),
    // Re-read the store: caller snapshots may predate an overlapping check's failure.
    recordedUpdateFailure: (target) => {
      const failure = (registry.getTarget(target.id) ?? target).managedServerUpdateFailure
      return failure?.appVersion === appVersion ? failure.reason : null
    },
    // Only attempted failures suppress retry; keep launch-only state out of peer-published SshTarget.
    failedThisLaunch: (target) => helixdUpdateFailedThisLaunch({ kind: 'ssh', id: target.id }),
    recordUpdateFailure: (target, reason) => {
      recordHelixdUpdateFailedThisLaunch(
        { kind: 'ssh', id: target.id },
        { code: 'helixd_update_failed', reason }
      )
      registry.updateTarget(target.id, { managedServerUpdateFailure: { reason, appVersion } })
    },
    clearUpdateFailure: (target) => {
      registry.updateTarget(target.id, { managedServerUpdateFailure: undefined })
    }
  }
}
