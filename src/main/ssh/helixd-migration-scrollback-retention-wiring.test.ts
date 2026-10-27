import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HelixdMigrationManifest } from '../../shared/helixd-migration/helixd-migration-manifest'
import type { HelixdMigrationSourceCutover } from '../../shared/helixd-migration/helixd-migration-source-cutover'

const journal = vi.hoisted(() => {
  const state: {
    cutovers: Pick<HelixdMigrationSourceCutover, 'phase' | 'manifest'>[]
    listener: ((userDataPath: string) => void) | null
  } = { cutovers: [], listener: null }
  return state
})
vi.mock('./helixd-migration-cutover-journal', () => ({
  listHelixdMigrationSourceCutovers: () => journal.cutovers,
  setHelixdMigrationJournalChangeListener: (listener: (path: string) => void) => {
    journal.listener = listener
  }
}))

const { installHelixdMigrationScrollbackRetention } =
  await import('./helixd-migration-scrollback-retention-wiring')

function manifest(migrationId: string): HelixdMigrationManifest {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the wiring only forwards manifests; the store fake reads the id.
  return { migrationId } as HelixdMigrationManifest
}

afterEach(() => {
  journal.cutovers = []
  journal.listener = null
})

describe('scrollback retention follows the migration journal', () => {
  it('holds from the fence until commit, across journal changes and a restart', () => {
    const sync = vi.fn<(pending: readonly HelixdMigrationManifest[]) => void>()
    const held = (): string[] =>
      (sync.mock.calls.at(-1)?.[0] ?? []).map((entry) => entry.migrationId)
    journal.cutovers = [{ phase: 'source-fenced', manifest: manifest('m1') }]

    // Startup rebuilds what an unfinished journal holds.
    installHelixdMigrationScrollbackRetention('/profile', {
      syncHelixdMigrationScrollbackRetention: sync
    })
    expect(held()).toEqual(['m1'])

    journal.cutovers = [{ phase: 'destination-staged', manifest: manifest('m1') }]
    journal.listener?.('/profile')
    expect(held()).toEqual(['m1'])

    journal.cutovers = [{ phase: 'destination-committed', manifest: manifest('m1') }]
    journal.listener?.('/profile')
    expect(held()).toEqual([])
  })

  it('keeps what it holds when the journal cannot be read', () => {
    const sync = vi.fn()
    installHelixdMigrationScrollbackRetention('/profile', {
      syncHelixdMigrationScrollbackRetention: sync
    })
    journal.cutovers = new Proxy([], {
      get: () => {
        throw new Error('unreadable')
      }
    })
    journal.listener?.('/profile')
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
