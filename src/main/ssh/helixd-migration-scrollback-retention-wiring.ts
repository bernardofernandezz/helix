import type { Store } from '../persistence'
import {
  listHelixdMigrationSourceCutovers,
  setHelixdMigrationJournalChangeListener
} from './helixd-migration-cutover-journal'

export function installHelixdMigrationScrollbackRetention(
  userDataPath: string,
  store: Pick<Store, 'syncHelixdMigrationScrollbackRetention'>
): void {
  const sync = (path: string): void => {
    try {
      // Retain bytes until durable commit/abort; closed tabs must still upload on retry.
      const pending = listHelixdMigrationSourceCutovers(path).filter(
        (cutover) => cutover.phase === 'source-fenced' || cutover.phase === 'destination-staged'
      )
      store.syncHelixdMigrationScrollbackRetention(pending.map((cutover) => cutover.manifest))
    } catch (error) {
      // An unreadable journal keeps whatever is held; releasing on a guess could lose bytes.
      console.warn('[helixd-migration] Could not sync scrollback retention:', error)
    }
  }
  setHelixdMigrationJournalChangeListener(sync)
  sync(userDataPath)
}
