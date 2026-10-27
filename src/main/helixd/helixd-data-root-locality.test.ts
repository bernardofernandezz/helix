import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { helixdDataRootIsOnLocalDisk } from './helixd-data-root-locality'

describe('helixdDataRootIsOnLocalDisk', () => {
  it.runIf(process.platform === 'linux' || process.platform === 'darwin')(
    'recognises a local temp directory, and refuses a path it cannot inspect',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'helixd-locality-'))
      try {
        expect(helixdDataRootIsOnLocalDisk(root)).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
      expect(helixdDataRootIsOnLocalDisk(join(root, 'missing'))).toBe(false)
    }
  )

  it('treats a Windows UNC data root as reachable from other machines', () => {
    expect(helixdDataRootIsOnLocalDisk('\\\\filer\\home\\helix', 'win32')).toBe(false)
    expect(helixdDataRootIsOnLocalDisk('\\\\?\\UNC\\filer\\home\\helix', 'win32')).toBe(false)
    expect(helixdDataRootIsOnLocalDisk('C:\\Users\\u\\AppData\\Roaming\\helix', 'win32')).toBe(true)
    expect(helixdDataRootIsOnLocalDisk('\\\\?\\C:\\Users\\u\\helix', 'win32')).toBe(true)
  })
})
