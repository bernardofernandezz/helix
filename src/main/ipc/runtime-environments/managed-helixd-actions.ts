import {
  cancelManagedHelixdStop,
  forgetManagedHelixdEnvironment,
  stopManagedHelixdEnvironment
} from '../../managed-server/lifecycle/helixd-runtime-decommission'
import { getManagedHelixdRuntimeStatus } from '../../managed-server/lifecycle/helixd-runtime-status'
import {
  recoverManagedHelixdEnvironment,
  rollbackManagedHelixdEnvironment,
  updateManagedHelixdEnvironment
} from '../../ssh/helixd-runtime-maintenance'
import { getHelixdSshDeployment } from '../../../shared/runtime-environments'
import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import type {
  HelixdManagedRestartResult,
  HelixdManagedStaleLockReclaimRequest,
  HelixdManagedStaleLockReclaimResult
} from '../../../shared/helixd-managed-runtime'
import { restartManagedHelixdEnvironment } from '../../managed-server/lifecycle/helixd-managed-launch-session'
import { runManagedHelixdStaleLockReclaim } from '../../managed-server/lifecycle/helixd-managed-stale-lock-reclaim'
import { clearLaunchSessionNote } from './runtime-environment-managed-tunnel'
import { forgetLaunchSessionVerdict } from '../ssh/ssh-host-launch-session-note'
import type { ManagedServerActions } from '../../runtime/managed-server-actions-registry'
import {
  retireRemovedRuntimeEnvironment,
  type RemovedServerStore
} from './runtime-environment-removal-cleanup'

export type ManagedHelixdActionOptions = {
  getUserDataPath: () => string
  getActiveEnvironmentId: () => string | null | undefined
  invalidateTransport: (environmentId: string) => Promise<void> | void
  clearHostServerNotes: (sshTargetId: string, environmentId: string) => void
  clearHostServerStatus: (sshTargetId: string) => void
  store: RemovedServerStore
}

export function createManagedHelixdActions(
  options: ManagedHelixdActionOptions
): ManagedServerActions {
  const userDataPath = options.getUserDataPath
  const unlinkPolicy = {
    isActiveEnvironment: (environmentId: string) =>
      options.getActiveEnvironmentId() === environmentId,
    retireLocalState: (environmentId: string) =>
      retireRemovedRuntimeEnvironment(
        environmentId,
        options.invalidateTransport,
        options.store,
        userDataPath()
      )
  }
  return {
    status: (selector) => getManagedHelixdRuntimeStatus(userDataPath(), selector),
    update: async (selector, force, pastLiveTerminals) => {
      const result = await updateManagedHelixdEnvironment(userDataPath(), {
        selector,
        force,
        ...(pastLiveTerminals ? { pastLiveTerminals } : {})
      })
      if (result.outcome === 'updated') {
        await options.invalidateTransport(result.environment.id)
      }
      if (result.outcome !== 'deferred') {
        const targetId = getHelixdSshDeployment(result.environment)?.sshTargetId
        if (targetId) {
          options.clearHostServerNotes(targetId, result.environment.id)
        }
      }
      return result
    },
    rollback: async (selector) => {
      const result = await rollbackManagedHelixdEnvironment(userDataPath(), { selector })
      if (result.outcome === 'rolled-back') {
        await options.invalidateTransport(result.environment.id)
      }
      return result
    },
    recover: async (selector, acceptChangedState) => {
      const result = await recoverManagedHelixdEnvironment(userDataPath(), {
        selector,
        acceptChangedState: acceptChangedState === true
      })
      if (result.outcome === 'recovered' && result.activeVersion) {
        await options.invalidateTransport(result.environment.id)
      }
      return result
    },
    stop: async (selector) => {
      const result = await stopManagedHelixdEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'unlinked') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    },
    cancelStop: (selector) => cancelManagedHelixdStop(userDataPath(), { selector }),
    forget: async (selector) => {
      const result = await forgetManagedHelixdEnvironment(
        userDataPath(),
        { selector },
        unlinkPolicy
      )
      if (result.outcome === 'forgotten') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    }
  }
}

export async function restartManagedHelixd(
  options: ManagedHelixdActionOptions,
  selector: string
): Promise<HelixdManagedRestartResult> {
  const result = await restartManagedHelixdEnvironment(options.getUserDataPath(), selector)
  if (result.outcome === 'restarted') {
    await reconnectRestartedManagedHelixd(options, result.environmentId)
  }
  return result
}

export async function reclaimManagedHelixdStaleLock(
  options: ManagedHelixdActionOptions,
  selector: string,
  request: HelixdManagedStaleLockReclaimRequest
): Promise<HelixdManagedStaleLockReclaimResult> {
  const result = await runManagedHelixdStaleLockReclaim(
    options.getUserDataPath(),
    selector,
    request
  )
  // Reconnect also replaces stale-lock feedback when no process had started.
  if (result.status === 'reclaimed') {
    await reconnectRestartedManagedHelixd(options, result.environmentId)
  }
  return result
}

async function reconnectRestartedManagedHelixd(
  options: ManagedHelixdActionOptions,
  environmentId: string
): Promise<void> {
  await options.invalidateTransport(environmentId)
  const environment = resolveEnvironment(options.getUserDataPath(), environmentId)
  const targetId = getHelixdSshDeployment(environment)?.sshTargetId
  if (targetId) {
    options.clearHostServerNotes(targetId, environmentId)
    forgetLaunchSessionVerdict(targetId)
    clearLaunchSessionNote(targetId, environmentId)
  }
}
