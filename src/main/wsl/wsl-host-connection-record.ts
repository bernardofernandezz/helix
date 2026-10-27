import { refreshWslHostPairing } from '../../shared/runtime-environment-wsl-host-store'
import {
  readWslHostDeployments,
  type WslHostDeploymentRecord
} from '../../shared/wsl-host-deployment-store'
import type { WslHostStatus } from '../../shared/wsl-host-types'
import type { WslHelixdConnection } from './wsl-helixd-connection'
import type { WslHelixdConnectionStatus } from './wsl-helixd-connection-status'

/** Saves an explicit re-pair or a moved bridge; true when the pairing changed. */
export function persistWslHostConnection(
  userDataPath: string,
  record: WslHostDeploymentRecord,
  connection: WslHelixdConnection
): boolean {
  try {
    return refreshWslHostPairing(userDataPath, record.environmentId, {
      pairingCode: connection.pairingOffer,
      localPort: connection.localPort,
      remotePort: connection.remotePort
    }).pairingChanged
  } catch (error) {
    console.warn(`[wsl-hosts] Could not save the new pairing for ${record.distro}:`, error)
    return false
  }
}

export function toWslHostStatus(
  record: WslHostDeploymentRecord,
  status: WslHelixdConnectionStatus,
  connection: WslHelixdConnection | null = null
): WslHostStatus {
  return {
    environmentId: record.environmentId,
    distro: record.distro,
    state: status.state,
    detail: status.state === 'failed' || status.state === 'unverifiable' ? status.reason : null,
    // Ready serves the incumbent; deferred serves nothing, so retain its Update/Force explanation.
    deferredUpdate:
      status.state === 'ready'
        ? (connection?.deferredUpdate ?? null)
        : status.state === 'failed'
          ? (status.deferredUpdate ?? null)
          : null
  }
}

/** Unreadable host records degrade to none so callers never connect from a half-read file. */
export function readWslHostRecords(userDataPath: string): WslHostDeploymentRecord[] {
  try {
    return readWslHostDeployments(userDataPath).deployments
  } catch (error) {
    console.warn('[wsl-hosts] Could not read WSL host records:', error)
    return []
  }
}
