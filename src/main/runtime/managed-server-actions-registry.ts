/** Desktop main publishes managed-server actions for runtime RPC; headless hosts without a registry advertise none. */
import type {
  HelixdManagedPastLiveTerminals,
  HelixdManagedCancelStopResult,
  HelixdManagedDeployResult,
  HelixdManagedForgetResult,
  HelixdManagedRecoveryResult,
  HelixdManagedRollbackResult,
  HelixdManagedRuntimeStatus,
  HelixdManagedStopResult
} from '../../shared/helixd-managed-runtime'

export type ManagedServerActions = {
  status: (selector: string) => Promise<HelixdManagedRuntimeStatus>
  update: (
    selector: string,
    force: boolean,
    pastLiveTerminals?: HelixdManagedPastLiveTerminals
  ) => Promise<HelixdManagedDeployResult>
  rollback: (selector: string) => Promise<HelixdManagedRollbackResult>
  /** `acceptChangedState` restores the snapshot over state a rejected build changed. */
  recover: (selector: string, acceptChangedState?: boolean) => Promise<HelixdManagedRecoveryResult>
  stop: (selector: string) => Promise<HelixdManagedStopResult>
  cancelStop: (selector: string) => Promise<HelixdManagedCancelStopResult>
  forget: (selector: string) => Promise<HelixdManagedForgetResult>
}

let registered: ManagedServerActions | null = null

export function registerManagedServerActions(actions: ManagedServerActions | null): void {
  registered = actions
}

export function getManagedServerActions(): ManagedServerActions | null {
  return registered
}
