import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { remoteHelixdBuildHashCommand } from './helixd-remote-build-hash'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

let directory = ''
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "helixd-hash-'quoted "))
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

it.skipIf(process.platform === 'win32').each([false, true])(
  'reads the installed build identity for split entry %s through a real POSIX shell',
  (splitEntry) => {
    const launcher = join(directory, 'helixd.js')
    writeFileSync(launcher, 'launcher\n')
    if (splitEntry) {
      writeFileSync(join(directory, 'helixd-server.js'), 'server\n')
    }
    const command = remoteHelixdBuildHashCommand(getRemoteHostPlatform('linux-x64'), directory)
    const run = (prefix = ''): string =>
      execFileSync('/bin/sh', ['-c', prefix + command], { encoding: 'utf8' }).trim()
    const legacyHash = createHash('sha256').update('launcher\n').digest('hex').slice(0, 16)
    const expected = `__HELIXD_BUILD_HASH__ ${legacyHash}`
    expect(run()).toBe(expected)
    expect(run('command() { [ "$2" = shasum ]; }; ')).toBe(expected)
  }
)

it.skipIf(process.platform === 'win32')(
  'refuses an absent launcher without publishing an empty-file hash',
  () => {
    const command = remoteHelixdBuildHashCommand(getRemoteHostPlatform('linux-x64'), directory)
    expect(() => execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).toThrow()
  }
)
