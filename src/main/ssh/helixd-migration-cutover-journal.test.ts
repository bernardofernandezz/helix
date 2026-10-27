import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeSecureJsonFileWithinLimit } from '../../shared/bounded-secure-json-file'
import { parseHelixdMigrationSourceCutover } from '../../shared/helixd-migration/helixd-migration-source-cutover'
import { helixdMigrationCutoverFixture as cutover } from './helixd-migration-cutover-fixture'
import {
  findHelixdMigrationSourceCutoverForTarget,
  listHelixdMigrationSourceCutovers,
  helixdMigrationCutoverJournalDirectory,
  removeHelixdMigrationSourceCutover,
  writeHelixdMigrationSourceCutover
} from './helixd-migration-cutover-journal'

let userDataPath: string
beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'helixd-cutover-journal-'))
})
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

const journalPath = (id: string) =>
  join(helixdMigrationCutoverJournalDirectory(userDataPath), `${id}.json`)

describe('migration cutover journal sidecar', () => {
  it('round-trips a cutover in an owner-only file', () => {
    writeHelixdMigrationSourceCutover(userDataPath, cutover())
    expect(findHelixdMigrationSourceCutoverForTarget(userDataPath, 'ssh-1')).toEqual(cutover())
    if (process.platform !== 'win32') {
      expect(statSync(journalPath('migration-1')).mode & 0o077).toBe(0)
    }
    removeHelixdMigrationSourceCutover(userDataPath, 'migration-1')
    expect(listHelixdMigrationSourceCutovers(userDataPath)).toEqual([])
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['a manifest bound to another target', JSON.stringify({ ...cutover(), sshTargetId: 'ssh-2' })],
    ['a tampered manifest', JSON.stringify({ ...cutover(), manifestSha256: 'f'.repeat(64) })],
    ['an unknown version', JSON.stringify({ ...cutover(), version: 2 })]
  ])('fails closed on %s', (_label, contents) => {
    mkdirSync(helixdMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('migration-1'), contents)
    expect(() => listHelixdMigrationSourceCutovers(userDataPath)).toThrow('stays fenced')
  })

  it("reads a newer build's journal that adds an optional field", () => {
    mkdirSync(helixdMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('migration-1'), JSON.stringify({ ...cutover(), addedLater: true }))
    expect(listHelixdMigrationSourceCutovers(userDataPath)).toEqual([cutover()])
  })

  it('serves repeat reads from cache yet sees a file rewritten behind its back', () => {
    writeHelixdMigrationSourceCutover(userDataPath, cutover())
    const first = listHelixdMigrationSourceCutovers(userDataPath)
    expect(listHelixdMigrationSourceCutovers(userDataPath)[0]).toBe(first[0])
    writeFileSync(
      journalPath('migration-1'),
      JSON.stringify({ ...cutover(), phase: 'destination-staged' })
    )
    expect(listHelixdMigrationSourceCutovers(userDataPath)[0]?.phase).toBe('destination-staged')
  })

  it('fails closed on a file whose name disagrees with its migration', () => {
    mkdirSync(helixdMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('other'), JSON.stringify(cutover()))
    expect(() => listHelixdMigrationSourceCutovers(userDataPath)).toThrow('stays fenced')
  })

  it('ignores durable-write temporaries but refuses two journals for one target', () => {
    writeHelixdMigrationSourceCutover(userDataPath, cutover())
    writeFileSync(join(helixdMigrationCutoverJournalDirectory(userDataPath), 'x.json.tmp'), '?')
    expect(listHelixdMigrationSourceCutovers(userDataPath)).toHaveLength(1)
    writeHelixdMigrationSourceCutover(userDataPath, cutover('migration-2'))
    expect(() => findHelixdMigrationSourceCutoverForTarget(userDataPath, 'ssh-1')).toThrow(
      'journals name SSH target'
    )
  })

  it('bounds concurrent migrations but rewrites an existing one', () => {
    for (const index of [1, 2, 3, 4]) {
      writeHelixdMigrationSourceCutover(userDataPath, cutover(`m-${index}`, `ssh-${index}`))
    }
    expect(() => writeHelixdMigrationSourceCutover(userDataPath, cutover('m-5', 'ssh-5'))).toThrow(
      'capacity'
    )
    writeHelixdMigrationSourceCutover(userDataPath, {
      ...cutover('m-1', 'ssh-1'),
      phase: 'destination-staged'
    })
    expect(findHelixdMigrationSourceCutoverForTarget(userDataPath, 'ssh-1')?.phase).toBe(
      'destination-staged'
    )
  })

  // Keep legacy SSH journal paths/bytes readable by downgraded desktops.
  it('writes the same path and bytes the SSH journal always wrote', () => {
    writeHelixdMigrationSourceCutover(userDataPath, cutover())
    expect(helixdMigrationCutoverJournalDirectory(userDataPath)).toBe(
      join(userDataPath, 'helixd-migration-cutovers')
    )
    const reference = join(userDataPath, 'reference.json')
    writeSecureJsonFileWithinLimit(
      reference,
      parseHelixdMigrationSourceCutover(cutover()),
      16 * 1024 * 1024,
      { durable: true }
    )
    expect(readFileSync(journalPath('migration-1'))).toEqual(readFileSync(reference))
  })
})
