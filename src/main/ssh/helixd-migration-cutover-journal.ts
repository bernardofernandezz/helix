/** Persist journals in owner-only profile sidecars: older profile schemas drop unknown fields but retain fences, so an in-profile journal could vanish on downgrade. Unreadable journals fail closed. */
import {
  MAX_HELIXD_MIGRATION_SOURCE_CUTOVERS,
  isRetainedHelixdMigrationSourceCutover,
  parseHelixdMigrationSourceCutover,
  type HelixdMigrationSourceCutover
} from '../../shared/helixd-migration/helixd-migration-source-cutover'
import {
  createMigrationJournalDirectory,
  orderMigrationJournalChain
} from '../persistence/migrating-helixd-catalog/migration-journal-directory'

class HelixdMigrationCutoverJournalUnreadableError extends Error {
  constructor(detail: string) {
    super(`The migration journal cannot be read, so the SSH host stays fenced: ${detail}`)
    this.name = 'HelixdMigrationCutoverJournalUnreadableError'
  }
}

type JournalChangeListener = (userDataPath: string) => void
let journalChangeListener: JournalChangeListener | null = null

export function setHelixdMigrationJournalChangeListener(
  listener: JournalChangeListener | null
): void {
  journalChangeListener = listener
}

const journals = createMigrationJournalDirectory({
  directoryName: 'helixd-migration-cutovers',
  // A manifest carries catalog rows and dormant session state, never scrollback bytes.
  maxFileBytes: 16 * 1024 * 1024,
  parse: parseHelixdMigrationSourceCutover,
  unreadable: (detail) => new HelixdMigrationCutoverJournalUnreadableError(detail),
  onChange: (userDataPath) => journalChangeListener?.(userDataPath)
})

export function helixdMigrationCutoverJournalDirectory(userDataPath: string): string {
  return journals.directory(userDataPath)
}

/** Never skip an unreadable or untrusted journal. */
export function listHelixdMigrationSourceCutovers(
  userDataPath: string
): HelixdMigrationSourceCutover[] {
  return journals.list(userDataPath)
}

export function findHelixdMigrationSourceCutoverForTarget(
  userDataPath: string,
  sshTargetId: string
): HelixdMigrationSourceCutover | null {
  const chain = listHelixdMigrationCutoverChainForTarget(userDataPath, sshTargetId)
  return chain.at(-1) ?? null
}

/** Oldest first; throws unless the target's journals form one chain of delta moves. */
export function listHelixdMigrationCutoverChainForTarget(
  userDataPath: string,
  sshTargetId: string
): HelixdMigrationSourceCutover[] {
  const matches = listHelixdMigrationSourceCutovers(userDataPath).filter(
    (cutover) => cutover.sshTargetId === sshTargetId
  )
  return orderMigrationJournalChain(
    matches,
    (detail) => new HelixdMigrationCutoverJournalUnreadableError(detail),
    `SSH target ${sshTargetId}`
  )
}

/** Flush before returning so later fence writes always have a durable journal. */
export function writeHelixdMigrationSourceCutover(
  userDataPath: string,
  cutover: HelixdMigrationSourceCutover
): void {
  const parsed = parseHelixdMigrationSourceCutover(cutover)
  const existing = listHelixdMigrationSourceCutovers(userDataPath)
  // Finished retained cutovers can wait two releases; only in-flight journals count toward the bound.
  const inFlight = existing.filter(
    (entry) => entry.phase !== 'source-retired' && !isRetainedHelixdMigrationSourceCutover(entry)
  )
  if (
    !existing.some((entry) => entry.migrationId === parsed.migrationId) &&
    inFlight.length >= MAX_HELIXD_MIGRATION_SOURCE_CUTOVERS
  ) {
    throw new Error('helixd_migration_cutover_capacity_exceeded')
  }
  journals.write(userDataPath, parsed)
}

export function removeHelixdMigrationSourceCutover(
  userDataPath: string,
  migrationId: string
): void {
  journals.remove(userDataPath, migrationId)
}

export function removeHelixdMigrationJournalsForDestination(
  userDataPath: string,
  sshTargetId: string,
  environmentId: string
): void {
  for (const cutover of listHelixdMigrationSourceCutovers(userDataPath)) {
    if (cutover.sshTargetId === sshTargetId && cutover.destinationEnvironmentId === environmentId) {
      removeHelixdMigrationSourceCutover(userDataPath, cutover.migrationId)
    }
  }
}
