import { describe, expect, it } from 'vitest'

import {
  captureHelixdStateSnapshotCommand,
  clearHelixdStateSnapshotMembersCommand,
  compareHelixdStateSnapshotCommand,
  helixdSnapshotDirName,
  parseHelixdSnapshotCapture,
  parseHelixdSnapshotPresence,
  parseHelixdSnapshotRestore,
  probeHelixdStateSnapshotCommand,
  restoreHelixdStateSnapshotCommand,
  HELIXD_STATE_MUTATION_DEADLINE_SECONDS
} from './helixd-state-snapshot'
import { newestStateMtimeCommand, parseNewestStateMtimeSeconds } from './helixd-state-newest-mtime'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { HELIXD_SNAPSHOT_EXCLUDED, HELIXD_SNAPSHOT_MEMBERS } from './helixd-state-snapshot-members'

const posix = getRemoteHostPlatform('linux-x64')
const windows = getRemoteHostPlatform('win32-x64')
const ROOT = '/home/u/.helix'
const SNAP = '/home/u/.helix-remote/helixd-state-snapshots/pre-0.2.0+bb01-1000'
const BASE = '/home/u/.helix-remote'

function memberLists(command: string): string[] {
  return [...command.matchAll(/for m in ([^;]+);/g)].map((match) => match[1])
}

function innerScript(command: string): string {
  return command.replaceAll(`'\\''`, `'`)
}

describe('capturing the pre-activation snapshot', () => {
  it('captures the profile state a rollback needs', () => {
    expect(memberLists(captureHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE))).toEqual([
      HELIXD_SNAPSHOT_MEMBERS.join(' ')
    ])
  })

  // Restoring daemon sockets, PID or auth tokens would break adoption of terminals surviving restart.
  it.each(HELIXD_SNAPSHOT_EXCLUDED)('never captures, removes or restores over %s', (excluded) => {
    const commands = [
      captureHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE),
      restoreHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE),
      clearHelixdStateSnapshotMembersCommand(posix, ROOT, BASE),
      compareHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE)
    ]
    for (const list of commands.flatMap(memberLists)) {
      expect(list.split(' ')).not.toContain(excluded)
    }
  })

  it('writes the archive under a temp name and renames, so a killed deploy leaves no torn tar', () => {
    const command = captureHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE)
    expect(command).toContain('.partial')
    expect(command.indexOf('tar -C')).toBeLessThan(command.indexOf('mv '))
  })

  it.each([
    ['CAPTURED', 'captured'],
    ['EMPTY', 'empty'],
    ['tar: broken', 'failed'],
    ['', 'failed'],
    // Gateways may append shell job notices after a valid verdict.
    ['CAPTURED\r\nsh: line 1:  2468 Terminated   ( while sleep 60 ... )\n', 'captured'],
    ['FAILED\nCAPTURED-looking noise', 'failed']
  ])('parses %j as %s', (output, expected) => {
    expect(parseHelixdSnapshotCapture(output)).toBe(expected)
  })

  it('keys the snapshot dir on both version and time, so a retry cannot overwrite one', () => {
    expect(helixdSnapshotDirName('0.2.0+bb01', 1000)).not.toBe(
      helixdSnapshotDirName('0.2.0+bb01', 2000)
    )
  })
})

describe('the host-side guard around every state mutation', () => {
  it.each([
    ['capture', () => captureHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE)],
    ['restore', () => restoreHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE)],
    ['clear', () => clearHelixdStateSnapshotMembersCommand(posix, ROOT, BASE)]
  ])('%s runs under the host lock and a host-enforced deadline', (_label, build) => {
    const command = build()
    expect(command).toContain(
      `helix_deadline="timeout -s KILL ${HELIXD_STATE_MUTATION_DEADLINE_SECONDS}"`
    )
    expect(command).toContain('helix_state_group $helix_deadline sh -c')
    expect(innerScript(command)).toContain(`lock='${BASE}/helixd-state-mutation.lock'`)
    expect(command).toContain('echo STATE_MUTATION_DEADLINE')
  })
})

describe('restoring the snapshot', () => {
  it('proves the archive extracts before clearing the live members', () => {
    const command = innerScript(restoreHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE))
    const extract = command.indexOf('tar -C "$stage" -xf "$archive"')
    expect(extract).toBeGreaterThan(-1)
    expect(extract).toBeLessThan(command.indexOf('rm -rf "$root/$m"'))
  })

  it('reports a missing archive instead of extracting nothing and claiming success', () => {
    expect(restoreHelixdStateSnapshotCommand(posix, ROOT, SNAP, BASE)).toContain('echo MISSING')
    expect(parseHelixdSnapshotRestore('MISSING')).toBe('missing')
    expect(parseHelixdSnapshotRestore('RESTORED')).toBe('restored')
    expect(parseHelixdSnapshotRestore('FAILED')).toBe('failed')
    expect(parseHelixdSnapshotRestore('RESTORED\nsh: line 1: 13 Terminated')).toBe('restored')
  })

  it.each([
    ['PRESENT', 'present'],
    ['ABSENT', 'absent'],
    ['', 'unverifiable'],
    ['bash: tar: command not found', 'unverifiable']
  ])('reads snapshot presence %j as %s, never treating silence as absence', (out, expected) => {
    expect(parseHelixdSnapshotPresence(out)).toBe(expected)
  })
})

describe('detecting writes since activation', () => {
  it.each([
    ['1700000000', 1_700_000_000],
    ['UNKNOWN', null],
    ['', null]
  ])('parses %s', (output, expected) => {
    expect(parseNewestStateMtimeSeconds(output)).toBe(expected)
  })

  it('looks at the same members the snapshot covers', () => {
    const command = newestStateMtimeCommand(posix, ROOT, BASE)
    for (const member of HELIXD_SNAPSHOT_MEMBERS) {
      expect(command).toContain(`'${member}'`)
    }
  })
})

describe('Windows hosts', () => {
  const BASE = 'C:/Users/u/.helix-remote'
  it.each([
    [
      'capture',
      'snapshot-capture',
      (base: string) => captureHelixdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    [
      'restore',
      'snapshot-restore',
      (base: string) => restoreHelixdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    [
      'clear',
      'snapshot-clear',
      (base: string) => clearHelixdStateSnapshotMembersCommand(windows, ROOT, base)
    ],
    [
      'presence',
      'snapshot-probe',
      (base: string) => probeHelixdStateSnapshotCommand(windows, SNAP, base)
    ],
    [
      'compare',
      'snapshot-compare',
      (base: string) => compareHelixdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    ['mtime', 'state-newest-mtime', (base: string) => newestStateMtimeCommand(windows, ROOT, base)]
  ])('%s runs the host script op %s with node.exe, never a POSIX command', (_label, op, build) => {
    const command = build(BASE)
    expect(command).toContain(` ${op} `)
    expect(command).toMatch(/^C:\\Users\\u\\\.helix-remote\\runtimes\\node-[0-9a-f]+\\node\.exe /u)
    expect(command).not.toMatch(/tar |find |diff |EncodedCommand|powershell/u)
  })
})
