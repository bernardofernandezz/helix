import { describe, expect, it } from 'vitest'
import { normalizeWslColdRestoreCwd } from './wsl-cold-restore-cwd'

const base = {
  platform: 'win32' as const,
  hostname: 'DESKTOP-HELIX',
  requestedCwd: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\repo',
  wslDistro: 'Ubuntu'
}

describe('normalizeWslColdRestoreCwd', () => {
  it.each([
    ['C:\\work', 'C:\\work'],
    ['\\\\wsl.localhost\\ubuntu\\home\\ana', '\\\\wsl.localhost\\ubuntu\\home\\ana'],
    ['/home/ana', '\\\\wsl.localhost\\Ubuntu\\home\\ana'],
    ['\\\\desktop-helix\\home\\ana', '\\\\wsl.localhost\\Ubuntu\\home\\ana'],
    ['\\\\DESKTOP-HELIX\\mnt\\c\\work', 'C:\\work']
  ])('allows or repairs %s', (recoveredCwd, expected) => {
    expect(normalizeWslColdRestoreCwd({ ...base, recoveredCwd })).toBe(expected)
  })

  it.each([
    '\\\\wsl.localhost\\Debian\\home\\ana',
    '\\\\server\\share\\repo',
    '//server/share/repo',
    'relative/path',
    '\\\\other-host\\home\\ana'
  ])('falls back instead of guessing for %s', (recoveredCwd) => {
    expect(normalizeWslColdRestoreCwd({ ...base, recoveredCwd })).toBe(base.requestedCwd)
  })
})
