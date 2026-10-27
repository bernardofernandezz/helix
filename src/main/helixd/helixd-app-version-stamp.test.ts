import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stampHelixdAppVersion } from './helixd-host-adapters'

describe('the Helix version a server reports', () => {
  let root: string
  let saved: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'helixd-app-version-'))
    saved = process.env.HELIX_APP_VERSION
    delete process.env.HELIX_APP_VERSION
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    if (saved === undefined) {
      delete process.env.HELIX_APP_VERSION
    } else {
      process.env.HELIX_APP_VERSION = saved
    }
  })

  it('is the release its bundle was built from, not a dev placeholder', () => {
    mkdirSync(join(root, 'out', 'cli'), { recursive: true })
    writeFileSync(join(root, 'out', 'package.json'), JSON.stringify({ version: '1.4.224' }))
    stampHelixdAppVersion(() => root)
    expect(process.env.HELIX_APP_VERSION).toBe('1.4.224')
  })

  it('replaces a version inherited from the Helix that started it', () => {
    process.env.HELIX_APP_VERSION = '1.4.300'
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(root, 'out', 'package.json'), JSON.stringify({ version: '1.4.224' }))
    stampHelixdAppVersion(() => root)
    expect(process.env.HELIX_APP_VERSION).toBe('1.4.224')
  })

  it('leaves the environment alone when the bundle has no version', () => {
    stampHelixdAppVersion(() => root)
    expect(process.env.HELIX_APP_VERSION).toBeUndefined()
    stampHelixdAppVersion(() => {
      throw new Error('helixd_install_root_unavailable')
    })
    expect(process.env.HELIX_APP_VERSION).toBeUndefined()
  })
})
