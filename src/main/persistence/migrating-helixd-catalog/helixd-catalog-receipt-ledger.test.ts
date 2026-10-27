import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { MAX_HELIXD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/helixd-migration/helixd-migration-manifest-validation'
import { manifest } from './persistence-helixd-migration-catalog-fixture'
import {
  expireHelixdMigrationStages,
  findHelixdMigrationImportReceipt,
  HELIXD_MIGRATION_STAGE_TTL_MS,
  recordHelixdMigrationImportReceipt
} from './helixd-catalog-receipt-ledger'

const empty = { repositories: [], projectGroups: [], folderWorkspaces: [] }

function receiptFor(migrationId: string) {
  const input = manifest({ migrationId, payload: empty })
  return {
    input,
    receipt: {
      version: input.version,
      migrationId,
      manifestSha256: input.manifestSha256,
      source: input.source,
      importedAt: '2026-10-01T00:00:00.000Z',
      repositoryIds: [],
      projectGroupIds: [],
      folderWorkspaceIds: []
    }
  }
}

describe('helixd migration receipt ledger', () => {
  it('keeps answering for a commit whose receipt aged out of the bounded list', () => {
    const state = getDefaultPersistedState('/tmp/helixd-receipt-ledger')
    const first = receiptFor('migration-0')
    recordHelixdMigrationImportReceipt(state, first.receipt)
    for (let index = 1; index <= MAX_HELIXD_MIGRATION_IMPORT_RECEIPTS; index++) {
      recordHelixdMigrationImportReceipt(state, receiptFor(`migration-${index}`).receipt)
    }
    expect(state.helixdMigrationImportReceipts).toHaveLength(MAX_HELIXD_MIGRATION_IMPORT_RECEIPTS)
    expect(findHelixdMigrationImportReceipt(state, first.input)).toEqual(first.receipt)
    expect(findHelixdMigrationImportReceipt(state, receiptFor('never').input)).toBeUndefined()
  })

  it('expires a stage no client came back for', () => {
    const state = getDefaultPersistedState('/tmp/helixd-receipt-ledger')
    const stagedAt = '2026-10-01T00:00:00.000Z'
    state.helixdMigrationStagedCatalogs = [{ version: 1, manifest: manifest(), stagedAt }]
    const start = Date.parse(stagedAt)
    expect(expireHelixdMigrationStages(state, start + HELIXD_MIGRATION_STAGE_TTL_MS - 1)).toBe(
      false
    )
    expect(expireHelixdMigrationStages(state, start + HELIXD_MIGRATION_STAGE_TTL_MS)).toBe(true)
    expect(state.helixdMigrationStagedCatalogs).toEqual([])
  })
})
