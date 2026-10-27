import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HELIXD_WINDOWS_BREAKAWAY_CONTRACT } from './windows-breakaway-launch'
import {
  keepPreviousStderrLog,
  parseWindowsBreakawayLaunchRequest
} from './windows-breakaway-launcher'

let dir: string | undefined
function makeDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'helix-breakaway-log-'))
  return dir
}
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

describe('keeping the previous helixd.log on Windows', () => {
  it('parses the opt-in flag without taking the next flag as its value', () => {
    const request = parseWindowsBreakawayLaunchRequest(HELIXD_WINDOWS_BREAKAWAY_CONTRACT, [
      'node.exe',
      'helixd.js',
      '--windows-breakaway-launch',
      '--stdout-file',
      'C:/slot/.helixd-readiness',
      '--stderr-file',
      'C:/slot/helixd.log',
      '--stderr-keep-previous',
      '--process-file',
      'C:/slot/.helixd-process.json',
      '--helixd-args',
      '--json'
    ])
    expect(request).toMatchObject({
      stderrPath: 'C:/slot/helixd.log',
      processFilePath: 'C:/slot/.helixd-process.json',
      keepPreviousStderr: true
    })
  })

  it('moves the last run log to .1, replacing an older one', () => {
    const log = join(makeDir(), 'helixd.log')
    writeFileSync(`${log}.1`, 'two runs ago')
    writeFileSync(log, 'crash: listen EADDRINUSE')
    keepPreviousStderrLog(log)
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('crash: listen EADDRINUSE')
    expect(existsSync(log)).toBe(false)
  })

  it('keeps only the tail of an oversized log', () => {
    const log = join(makeDir(), 'helixd.log')
    writeFileSync(log, `${'x'.repeat(100)}last error`)
    keepPreviousStderrLog(log, 10)
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('last error')
  })

  it('does nothing when there is no previous log', () => {
    const log = join(makeDir(), 'helixd.log')
    expect(() => keepPreviousStderrLog(log)).not.toThrow()
    expect(existsSync(`${log}.1`)).toBe(false)
  })
})
