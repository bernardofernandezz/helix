import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getManagedHelixdFenceEnvironmentId } from '../../shared/managed-helixd-ssh-owner'
import type { SshTarget } from '../../shared/ssh-types'
import type { HelixdMigrationManifest } from '../../shared/helixd-migration/helixd-migration-manifest'
import { closeTestStores, createSqliteTestStore } from '../persistence/persistence-test-harness'
import { Store } from '../persistence/loading-store/store'
import {
  abortHelixdMigrationCutover,
  commitHelixdMigrationDestination,
  stageHelixdMigrationDestination,
  type HelixdMigrationCutoverContext
} from './helixd-migration-cutover-coordinator'
import { HELIXD_MIGRATION_DESTINATION_UNSUPPORTED } from './helixd-migration-catalog-client'
import {
  listHelixdMigrationSourceCutovers,
  writeHelixdMigrationSourceCutover
} from './helixd-migration-cutover-journal'
import {
  assertHelixdMigrationRequestFits,
  createHelixdMigrationManifest
} from './helixd-migration-manifest-export'
import { MAX_HELIXD_MIGRATION_MANIFEST_BYTES } from '../../shared/helixd-migration/helixd-migration-manifest-validation'
import { fenceHelixdMigrationSource } from './helixd-migration-source-fence'
import { SshTargetHelixdClaims } from './targets/ssh-target-helixd-claims'
import { fakeHelixdMigrationDestination as fakeDestination } from './helixd-migration-destination-fake'

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 2
}

const directories: string[] = []
afterEach(async () => {
  await closeTestStores()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function setup() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'helixd-cutover-coordinator-'))
  directories.push(userDataPath)
  const store = createSqliteTestStore(Store, { dataFile: join(userDataPath, 'helix-data.json') })
  store.addSshTarget(TARGET)
  store.addRepo({
    id: 'repo-1',
    path: '/srv/app',
    displayName: 'App',
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    connectionId: TARGET.id
  })
  const claims = new SshTargetHelixdClaims(store)
  const fenced = await fenceHelixdMigrationSource({
    userDataPath,
    store,
    claims,
    targetId: TARGET.id,
    destinationEnvironmentId: 'env-1',
    destinationName: 'Managed',
    terminalProof: { verdict: 'exited', provenPtyIds: [] }
  })
  if (fenced.outcome !== 'fenced') {
    throw new Error('expected a fence')
  }
  const destination = fakeDestination()
  const context: HelixdMigrationCutoverContext = { userDataPath, store, claims, destination }
  const journal = () => listHelixdMigrationSourceCutovers(userDataPath)[0]
  const owner = () => getManagedHelixdFenceEnvironmentId(store.getSshTarget(TARGET.id))
  return { context, destination, store, migrationId: fenced.cutover.migrationId, journal, owner }
}

describe('migration cutover coordinator', () => {
  it('stages then commits once, journaling each phase the destination proves', async () => {
    const h = await setup()
    await expect(stageHelixdMigrationDestination(h.context, h.migrationId)).resolves.toMatchObject({
      phase: 'destination-staged'
    })
    expect(h.journal()?.phase).toBe('destination-staged')
    await expect(commitHelixdMigrationDestination(h.context, h.migrationId)).resolves.toMatchObject(
      {
        phase: 'destination-committed'
      }
    )
    expect(h.journal()?.phase).toBe('destination-committed')
    await commitHelixdMigrationDestination(h.context, h.migrationId)
    expect(h.destination.commits).toBe(1)
  })

  it('reads a lost commit reply back from the destination instead of failing or retrying blind', async () => {
    const h = await setup()
    await stageHelixdMigrationDestination(h.context, h.migrationId)
    const commit = h.destination.commit.getMockImplementation()!
    h.destination.commit.mockImplementationOnce(async (manifest) => {
      await commit(manifest)
      throw new Error('socket closed')
    })
    await expect(commitHelixdMigrationDestination(h.context, h.migrationId)).resolves.toMatchObject(
      {
        phase: 'destination-committed'
      }
    )
    expect(h.destination.commits).toBe(1)
  })

  it('never journals a commit the server holds only in memory, until its flush succeeds', async () => {
    const h = await setup()
    await stageHelixdMigrationDestination(h.context, h.migrationId)
    const commit = h.destination.commit.getMockImplementation()!
    let diskFull = true
    // Committed reads can reflect memory while the durable flush still fails.
    h.destination.commit.mockImplementation(async (manifest) => {
      const state = await commit(manifest)
      if (diskFull) {
        throw new Error('disk full')
      }
      return state
    })
    await expect(commitHelixdMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'disk full'
    )
    await expect(commitHelixdMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'disk full'
    )
    await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).rejects.toThrow('disk full')
    expect(h.journal()?.phase).toBe('destination-staged')
    expect(h.owner()).toBe('env-1')

    diskFull = false
    await expect(commitHelixdMigrationDestination(h.context, h.migrationId)).resolves.toMatchObject(
      {
        phase: 'destination-committed'
      }
    )
  })

  it('keeps the journal at staged when the commit reply and the re-read are both lost', async () => {
    const h = await setup()
    await stageHelixdMigrationDestination(h.context, h.migrationId)
    h.destination.commit.mockRejectedValueOnce(new Error('socket closed'))
    h.destination.readState.mockRejectedValueOnce(new Error('socket closed'))
    await expect(commitHelixdMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'socket closed'
    )
    expect(h.journal()?.phase).toBe('destination-staged')
    expect(h.owner()).toBe('env-1')
  })

  it.each([
    [
      'a source row changed',
      (store: Store) => store.updateRepo(store.getRepo('repo-1')!, { displayName: 'Renamed' }),
      'helixd_migration_source_changed'
    ],
    [
      'a terminal started on the source',
      (store: Store) =>
        vi
          .spyOn(store, 'getSshRemotePtyLeases')
          .mockReturnValue([
            { targetId: TARGET.id, ptyId: 'late', state: 'attached', createdAt: 1, updatedAt: 1 }
          ]),
      'helixd_migration_source_terminals_live'
    ]
  ])('refuses to stage or commit after %s', async (_label, change, code) => {
    const h = await setup()
    change(h.store)
    await expect(stageHelixdMigrationDestination(h.context, h.migrationId)).rejects.toThrow(code)
    expect(h.destination.stage).not.toHaveBeenCalled()
  })

  it('refuses a commit whose source changed after staging', async () => {
    const h = await setup()
    await stageHelixdMigrationDestination(h.context, h.migrationId)
    h.store.updateRepo(h.store.getRepo('repo-1')!, { displayName: 'Renamed' })
    await expect(commitHelixdMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'helixd_migration_source_changed'
    )
    expect(h.destination.commit).not.toHaveBeenCalled()
  })

  it('aborts a stage and releases the fence only once the destination proves it absent', async () => {
    const h = await setup()
    await stageHelixdMigrationDestination(h.context, h.migrationId)
    await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).resolves.toEqual({
      outcome: 'released',
      evidence: 'catalog-absent'
    })
    expect(h.owner()).toBeNull()
    expect(h.journal()).toBeUndefined()
  })

  it('keeps the fence when the abort answer is lost and the destination cannot be read', async () => {
    const h = await setup()
    await stageHelixdMigrationDestination(h.context, h.migrationId)
    h.destination.abort.mockRejectedValueOnce(new Error('socket closed'))
    h.destination.readState.mockResolvedValueOnce({
      state: 'absent',
      migrationId: h.migrationId,
      manifestSha256: h.journal()!.manifestSha256
    })
    h.destination.readState.mockRejectedValueOnce(new Error('socket closed'))
    h.destination.abort.mockRejectedValueOnce(new Error('socket closed'))
    await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).rejects.toThrow(
      'socket closed'
    )
    expect(h.owner()).toBe('env-1')
    expect(h.journal()?.phase).toBe('destination-staged')
  })

  it('never releases a committed destination, even when the journal lags behind it', async () => {
    const h = await setup()
    await stageHelixdMigrationDestination(h.context, h.migrationId)
    await h.destination.commit(h.journal()!.manifest)
    await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
      outcome: 'refused',
      code: 'helixd_migration_committed_source_cannot_be_released'
    })
    expect(h.journal()?.phase).toBe('destination-committed')
    expect(h.owner()).toBe('env-1')
    await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
      outcome: 'refused'
    })
  })

  it('releases on an unsupported destination only before anything was staged', async () => {
    const unsupported = new Error(HELIXD_MIGRATION_DESTINATION_UNSUPPORTED)
    const fresh = await setup()
    fresh.destination.readState.mockRejectedValueOnce(unsupported)
    await expect(abortHelixdMigrationCutover(fresh.context, fresh.migrationId)).resolves.toEqual({
      outcome: 'released',
      evidence: 'destination-unsupported'
    })
    expect(fresh.owner()).toBeNull()

    const staged = await setup()
    await stageHelixdMigrationDestination(staged.context, staged.migrationId)
    staged.destination.readState.mockRejectedValueOnce(unsupported)
    await expect(abortHelixdMigrationCutover(staged.context, staged.migrationId)).rejects.toThrow(
      HELIXD_MIGRATION_DESTINATION_UNSUPPORTED
    )
    expect(staged.owner()).toBe('env-1')
  })

  it('treats any other read failure at abort as unverifiable and keeps the fence', async () => {
    const h = await setup()
    h.destination.readState.mockRejectedValueOnce(new Error('socket closed'))
    await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).rejects.toThrow(
      'socket closed'
    )
    expect(h.owner()).toBe('env-1')
  })

  it('refuses a destination answer for another manifest', async () => {
    const h = await setup()
    h.destination.stage.mockResolvedValueOnce({
      state: 'staged',
      migrationId: h.migrationId,
      manifestSha256: 'f'.repeat(64),
      stagedAt: '2026-10-01T00:00:00.000Z'
    })
    await expect(stageHelixdMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'helixd_migration_destination_state_mismatch'
    )
    expect(h.journal()?.phase).toBe('source-fenced')
  })

  describe('a journal fenced before on a manifest no request can carry', () => {
    async function stuck(stagedByOlderBuild = false) {
      const h = await setup()
      const cutover = h.journal()!
      const target = {
        ...h.store.getSshTarget(TARGET.id)!,
        generation: cutover.sshTargetGeneration
      }
      const exportFor = () =>
        createHelixdMigrationManifest(h.store, target, {
          migrationId: cutover.migrationId,
          destinationEnvironmentId: cutover.destinationEnvironmentId
        })
      const baseline = JSON.stringify(exportFor()).length
      // Under the export cap, over the sealed-frame request budget.
      h.store.updateRepo(h.store.getRepo('repo-1')!, {
        displayName: 'x'.repeat(MAX_HELIXD_MIGRATION_MANIFEST_BYTES - 200 - baseline)
      })
      const manifest = exportFor()
      expect(() => assertHelixdMigrationRequestFits({ manifest })).toThrow(
        /helixd_migration_manifest_too_large/
      )
      writeHelixdMigrationSourceCutover(h.context.userDataPath, {
        ...cutover,
        manifestSha256: manifest.manifestSha256,
        manifest
      })
      if (stagedByOlderBuild) {
        // A build before the client-side size check sent it whole, and the frame fit.
        await h.destination.stage(manifest)
      }
      // Model client refusal before sending oversized manifest requests.
      const refuseUnsent =
        <T>(real: (sent: HelixdMigrationManifest) => Promise<T>) =>
        async (sent: HelixdMigrationManifest): Promise<T> => {
          assertHelixdMigrationRequestFits({ manifest: sent })
          return real(sent)
        }
      const d = h.destination
      d.readState.mockImplementation(refuseUnsent(d.readState.getMockImplementation()!))
      d.stage.mockImplementation(refuseUnsent(d.stage.getMockImplementation()!))
      d.commit.mockImplementation(refuseUnsent(d.commit.getMockImplementation()!))
      d.abort.mockImplementation(refuseUnsent(d.abort.getMockImplementation()!))
      return { ...h, manifest }
    }

    it('releases the fence once the server, asked by reference, proves it holds nothing', async () => {
      const h = await stuck()
      await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).resolves.toEqual({
        outcome: 'released',
        evidence: 'catalog-absent'
      })
      expect(h.destination.abortByReference).toHaveBeenCalledWith(h.manifest)
      expect(h.owner()).toBeNull()
      expect(h.journal()).toBeUndefined()
    })

    it('aborts, by reference, a stage an older build delivered whole', async () => {
      const h = await stuck(true)
      await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
        outcome: 'released'
      })
      await expect(h.destination.abortByReference.mock.results[0]?.value).resolves.toMatchObject({
        state: 'absent',
        aborted: true
      })
      expect(h.owner()).toBeNull()
    })

    it('keeps the fence when the server cannot answer by reference', async () => {
      const h = await stuck()
      h.destination.abortByReference.mockRejectedValueOnce(new Error('update required'))
      await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).rejects.toThrow(
        'update required'
      )
      expect(h.owner()).toBe('env-1')
      expect(h.journal()?.migrationId).toBe(h.migrationId)
    })

    it('never releases a server that already committed it', async () => {
      const h = await stuck()
      h.destination.abortByReference.mockResolvedValueOnce({
        migrationId: h.migrationId,
        manifestSha256: h.manifest.manifestSha256,
        state: 'committed',
        aborted: false
      })
      await expect(abortHelixdMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
        outcome: 'refused',
        code: 'helixd_migration_committed_source_cannot_be_released'
      })
      expect(h.owner()).toBe('env-1')
    })
  })
})
