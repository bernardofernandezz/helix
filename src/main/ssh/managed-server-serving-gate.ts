import type { HostServerUpdateOnConnect } from './managed-server-update-check'
import {
  MANAGED_HELIXD_FENCED_DETAIL,
  MANAGED_HELIXD_NOT_ACTIVATED_DETAIL,
  type HelixdManagedServing
} from '../managed-server/lifecycle/helixd-managed-serving'
import type { HostServerOnConnectResult } from './ssh-host-server-on-connect'

type ManagedRoute = Extract<HostServerOnConnectResult, { route: 'managed' }>

/** No active version continues to update/redeploy the still-linked server; return a managed result for other non-serving states. */
export function unservedManagedResult(
  environmentId: string,
  serving: HelixdManagedServing
): ManagedRoute | null {
  if (serving.state !== 'unverifiable' || serving.detail === MANAGED_HELIXD_NOT_ACTIVATED_DETAIL) {
    return null
  }
  // Still the managed route: a stopped server says nothing about the host's terminals.
  return {
    route: 'managed',
    environmentId,
    serving,
    ...(serving.detail === MANAGED_HELIXD_FENCED_DETAIL ? { fenceHeld: true as const } : {})
  }
}

/** Preserve the not-activated note when update did not restore service. */
export function managedResultAfterUpdate(
  environmentId: string,
  serving: HelixdManagedServing,
  { note, reason, fenceBusy }: HostServerUpdateOnConnect
): ManagedRoute {
  return {
    route: 'managed',
    environmentId,
    ...(note ? { update: note } : {}),
    ...(serving.state === 'unverifiable' && reason !== 'updated' ? { serving } : {}),
    ...(fenceBusy ? { fenceHeld: true as const } : {})
  }
}
