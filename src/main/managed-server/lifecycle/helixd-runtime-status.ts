import type { HelixdManagedRuntimeStatus } from '../../../shared/helixd-managed-runtime'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import type { HelixdActivationTransaction } from '../activation/helixd-activation-transaction'
import { readHelixdActivationTransaction } from '../activation/helixd-activation-transaction-store'
import {
  requireManagedHelixdEnvironment,
  resolveLinkedHelixdContext
} from './helixd-managed-runtime-context'
import { currentManagedHelixdUpdateDeferral } from './helixd-managed-update-deferrals'
import { findIncompleteManagedHelixdMigration } from './helixd-managed-migration-status'
import { collectManagedTerminalCensus } from '../../ssh/helixd-terminal-census-client'
import { getAppEnvironment } from '../../../shared/app-environment'
import { bundledManagedHelixdVersion } from './helixd-managed-auto-update'
import { availableManagedHelixdUpdate } from './helixd-managed-update-decision'

/** Read host records without repairing them. */
export async function getManagedHelixdRuntimeStatus(
  userDataPath: string,
  selector: string,
  signal?: AbortSignal
): Promise<HelixdManagedRuntimeStatus> {
  const { environment, deployment } = requireManagedHelixdEnvironment(userDataPath, selector)
  const { status, record, serverTarget } = await runTargetLifecycle(
    deployment.sshTargetId,
    async () => {
      const context = await resolveLinkedHelixdContext(environment, deployment, signal)
      const record = context.activationRecord
      const transaction = await readHelixdActivationTransaction({
        conn: context.connection,
        host: context.host,
        remoteHome: context.remoteHome,
        signal
      })
      const status: HelixdManagedRuntimeStatus = {
        environmentId: environment.id,
        sshTargetId: context.target.id,
        activeVersion: record.active,
        activeAppVersion: record.active ? (record.activeAppVersion ?? null) : null,
        previousVersion: record.previous,
        activatedAt: record.activatedAt,
        rollbackAvailable: Boolean(record.previous && record.snapshot),
        recovery: transaction ? managedRecoveryStatus(transaction) : null,
        terminals: await collectManagedTerminalCensus(userDataPath, environment, record),
        migration: migrationStatus(userDataPath, environment.id),
        deferredUpdate: currentManagedHelixdUpdateDeferral(environment.id, record.active)
      }
      return { status, record, serverTarget: context.serverTarget }
    }
  )
  // Outside the host queue: hashing the local template must not hold up host actions.
  // A local template fault hides only the offer, never the host's status.
  const candidateVersion = await bundledManagedHelixdVersion(serverTarget).catch(() => null)
  return {
    ...status,
    availableUpdate: availableManagedHelixdUpdate({
      record,
      candidateVersion,
      appVersion: getAppEnvironment().getVersion(),
      deferredCandidateVersion: status.deferredUpdate?.candidateVersion ?? null
    })
  }
}

function managedRecoveryStatus(
  transaction: HelixdActivationTransaction
): NonNullable<HelixdManagedRuntimeStatus['recovery']> {
  switch (transaction.operation) {
    case 'activate':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.candidateVersion,
        startedAt: transaction.startedAt
      }
    case 'rollback':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.targetVersion,
        startedAt: transaction.startedAt
      }
    case 'decommission':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.activeVersion,
        startedAt: transaction.startedAt
      }
  }
}

function migrationStatus(
  userDataPath: string,
  environmentId: string
): HelixdManagedRuntimeStatus['migration'] {
  const migration = findIncompleteManagedHelixdMigration(userDataPath, environmentId)
  return migration
    ? { migrationId: migration.migrationId, phase: migration.phase, startedAt: migration.startedAt }
    : null
}
