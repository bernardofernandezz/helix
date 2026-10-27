/** Managed helixd servers over SSH; desktop-only, so web clients leave it undefined. */
import { ipcRenderer } from 'electron'
import type {
  HelixdDeltaMovePreview,
  HelixdDeltaMoveResult,
  HelixdManagedCancelStopResult,
  HelixdManagedConversionResult,
  HelixdManagedDeployResult,
  HelixdManagedForgetResult,
  HelixdManagedPastLiveTerminals,
  HelixdManagedPendingMigrationRow,
  HelixdManagedRecoveryResult,
  HelixdManagedRestartResult,
  HelixdManagedStaleLockReclaimRequest,
  HelixdManagedStaleLockReclaimResult,
  HelixdManagedRollbackResult,
  HelixdManagedRuntimeStatus,
  HelixdManagedStopResult
} from '../../shared/helixd-managed-runtime'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type {
  RuntimeSshAccessLinkRequest,
  RuntimeSshAccessUnlinkRequest
} from '../../shared/runtime-ssh-access'

export type ManagedHelixdPreloadApi = {
  deploy: (args: {
    name: string
    sshTargetId: string
    force?: boolean
  }) => Promise<HelixdManagedDeployResult>
  getStatus: (args: { selector: string }) => Promise<HelixdManagedRuntimeStatus>
  update: (args: {
    selector: string
    force?: boolean
    pastLiveTerminals?: HelixdManagedPastLiveTerminals
  }) => Promise<HelixdManagedDeployResult>
  rollback: (args: { selector: string }) => Promise<HelixdManagedRollbackResult>
  recover: (args: {
    selector: string
    /** Restore the snapshot over state a rejected build changed; see HELIXD_RECOVERY_CHANGED_STATE_CODE. */
    acceptChangedState?: boolean
  }) => Promise<HelixdManagedRecoveryResult>
  /** Restarts from this client's SSH session; refused while terminals run. */
  restart: (args: { selector: string }) => Promise<HelixdManagedRestartResult>
  /** Without `yes`, only reports whether the host's instance lock may be cleared. */
  reclaimStaleLock: (
    args: { selector: string } & HelixdManagedStaleLockReclaimRequest
  ) => Promise<HelixdManagedStaleLockReclaimResult>
  stop: (args: { selector: string }) => Promise<HelixdManagedStopResult>
  cancelStop: (args: { selector: string }) => Promise<HelixdManagedCancelStopResult>
  forget: (args: { selector: string }) => Promise<HelixdManagedForgetResult>
  linkSshAccess: (args: RuntimeSshAccessLinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  unlinkSshAccess: (args: RuntimeSshAccessUnlinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  convertSshHost: (args: {
    sshTargetId: string
    name: string
  }) => Promise<HelixdManagedConversionResult>
  listPendingMigrations: () => Promise<HelixdManagedPendingMigrationRow[]>
  previewDeltaMove: (args: { sshTargetId: string }) => Promise<HelixdDeltaMovePreview>
  moveDelta: (args: { sshTargetId: string }) => Promise<HelixdDeltaMoveResult>
  keepServerVersion: (args: { sshTargetId: string }) => Promise<void>
  /** "Move anyway": the next connect leaves what can't move on this desktop. */
  allowMoveLeavingBehind: (args: { sshTargetId: string }) => Promise<void>
}

export const managedHelixdApi: ManagedHelixdPreloadApi = {
  deploy: (args) => ipcRenderer.invoke('runtimeEnvironments:deployHelixd', args),
  getStatus: (args) => ipcRenderer.invoke('runtimeEnvironments:getHelixdStatus', args),
  update: (args) => ipcRenderer.invoke('runtimeEnvironments:updateHelixd', args),
  rollback: (args) => ipcRenderer.invoke('runtimeEnvironments:rollbackHelixd', args),
  recover: (args) => ipcRenderer.invoke('runtimeEnvironments:recoverHelixd', args),
  restart: (args) => ipcRenderer.invoke('runtimeEnvironments:restartHelixd', args),
  reclaimStaleLock: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:reclaimHelixdStaleLock', args),
  stop: (args) => ipcRenderer.invoke('runtimeEnvironments:stopHelixd', args),
  cancelStop: (args) => ipcRenderer.invoke('runtimeEnvironments:cancelHelixdStop', args),
  forget: (args) => ipcRenderer.invoke('runtimeEnvironments:forgetHelixd', args),
  linkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:linkSshAccess', args),
  unlinkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:unlinkSshAccess', args),
  convertSshHost: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:convertSshHostToManagedHelixd', args),
  listPendingMigrations: () =>
    ipcRenderer.invoke('runtimeEnvironments:listPendingHelixdMigrations'),
  previewDeltaMove: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:previewHelixdDeltaMove', args),
  moveDelta: (args) => ipcRenderer.invoke('runtimeEnvironments:moveHelixdDelta', args),
  keepServerVersion: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:keepHelixdServerVersion', args),
  allowMoveLeavingBehind: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:allowHelixdMoveLeavingBehind', args)
}
