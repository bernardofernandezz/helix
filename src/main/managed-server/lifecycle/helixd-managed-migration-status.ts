import {
  isRetainedHelixdMigrationSourceCutover,
  type HelixdMigrationSourceCutover
} from '../../../shared/helixd-migration/helixd-migration-source-cutover'
import {
  getHelixdSshDeployment,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { listHelixdMigrationSourceCutovers } from '../../ssh/helixd-migration-cutover-journal'

type HelixdManagedPendingMigration = {
  migrationId: string
  environmentId: string
  name: string
  sshTargetId: string
  phase: HelixdMigrationSourceCutover['phase']
  startedAt: string
}

/** Unreadable journals must not look like absent migrations. */
export function listPendingManagedHelixdMigrations(
  userDataPath: string
): HelixdManagedPendingMigration[] {
  return (
    listHelixdMigrationSourceCutovers(userDataPath)
      // Committed/retained journals preserve downgrade recovery, not pending migration work.
      .filter(
        (cutover) =>
          cutover.phase !== 'source-retired' && !isRetainedHelixdMigrationSourceCutover(cutover)
      )
      .map((cutover) => ({
        migrationId: cutover.migrationId,
        environmentId: cutover.destinationEnvironmentId,
        name: cutover.destinationName,
        sshTargetId: cutover.sshTargetId,
        phase: cutover.phase,
        startedAt: cutover.startedAt
      }))
  )
}

export function findIncompleteManagedHelixdMigration(
  userDataPath: string,
  environmentId: string
): HelixdManagedPendingMigration | null {
  return (
    listPendingManagedHelixdMigrations(userDataPath).find(
      (migration) => migration.environmentId === environmentId
    ) ?? null
  )
}

export function environmentMatchesManagedHelixdCutover(
  environment: KnownRuntimeEnvironment,
  cutover: HelixdMigrationSourceCutover
): boolean {
  const deployment = getHelixdSshDeployment(environment)
  return (
    environment.id === cutover.destinationEnvironmentId &&
    environment.name === cutover.destinationName &&
    deployment?.sshTargetId === cutover.sshTargetId &&
    deployment.sshTargetGeneration === cutover.sshTargetGeneration
  )
}
