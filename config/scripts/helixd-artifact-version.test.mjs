import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HELIXD_MOBILE_WEB_MANIFEST,
  HELIXD_NODE_RUNTIME_MARKER_FILENAME,
  HELIXD_SERVER_TARGET_FILENAME,
  helixdArtifactFilenames,
  helixdRipgrepArtifact
} from '../../src/shared/helixd-artifacts.ts'
import { SERVER_TARGETS } from '../../src/shared/node-runtime-pin.ts'
import { helixdAgentBrowserNativeName } from '../../src/shared/helixd-agent-browser-name.ts'
import { readHelixdArtifactIdentity } from '../../src/main/helixd/helixd-artifact-identity.ts'
import { computeHelixdFullVersion } from './helixd-artifact-version.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const PAGE_ASSET = 'out/mobile-web/index.html'
const PAGE_MANIFEST = JSON.stringify({ assets: [{ path: 'index.html' }] })

function createArtifactDirectory(target = 'linux-x64-glibc') {
  const directory = mkdtempSync(join(tmpdir(), 'helixd-version-'))
  directories.push(directory)
  for (const filename of helixdArtifactFilenames(target, [PAGE_ASSET])) {
    const path = join(directory, filename)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, filename === HELIXD_MOBILE_WEB_MANIFEST ? PAGE_MANIFEST : filename)
  }
  writeFileSync(join(directory, HELIXD_SERVER_TARGET_FILENAME), `${target}\n`)
  return directory
}

describe('standalone runtime version', () => {
  it('changes when a shipped search binary changes and rejects a missing binary', () => {
    const target = 'linux-x64-glibc'
    const dir = createArtifactDirectory(target)
    const before = computeHelixdFullVersion(dir, { target })
    const binary = join(dir, helixdRipgrepArtifact(target))
    writeFileSync(binary, 'updated binary')
    expect(computeHelixdFullVersion(dir, { target })).not.toBe(before)
    rmSync(binary)
    expect(() => computeHelixdFullVersion(dir, { target })).toThrow(helixdRipgrepArtifact(target))
  })

  it('changes when a page asset changes and rejects a missing one', () => {
    const target = 'linux-x64-glibc'
    const dir = createArtifactDirectory(target)
    const before = computeHelixdFullVersion(dir, { target })
    writeFileSync(join(dir, PAGE_ASSET), 'updated page')
    expect(computeHelixdFullVersion(dir, { target })).not.toBe(before)
    rmSync(join(dir, PAGE_ASSET))
    expect(() => computeHelixdFullVersion(dir, { target })).toThrow(PAGE_ASSET)
  })

  it('keys the version on the referenced runtime digest rather than its bytes', () => {
    const target = 'darwin-arm64'
    const dir = createArtifactDirectory(target)
    writeFileSync(join(dir, HELIXD_NODE_RUNTIME_MARKER_FILENAME), `${'a'.repeat(64)}\n`)
    const before = computeHelixdFullVersion(dir, { target })
    writeFileSync(join(dir, HELIXD_NODE_RUNTIME_MARKER_FILENAME), `${'b'.repeat(64)}\n`)
    expect(computeHelixdFullVersion(dir, { target })).not.toBe(before)
  })

  it.each(SERVER_TARGETS)(
    'matches the installed %s identity with and without its optional browser',
    async (target) => {
      const dir = createArtifactDirectory(target)
      const [platform, arch] = target.split('-')
      const agentBrowserFilename = helixdAgentBrowserNativeName(
        platform,
        arch,
        target.endsWith('-musl') ? 'musl' : 'glibc'
      )
      const options = { target, agentBrowserFilename }
      const withoutBrowser = computeHelixdFullVersion(dir, options)
      expect(withoutBrowser).toBe(await readHelixdArtifactIdentity(dir))
      writeFileSync(join(dir, agentBrowserFilename), 'browser')
      const withBrowser = computeHelixdFullVersion(dir, options)
      expect(withBrowser).not.toBe(withoutBrowser)
      expect(withBrowser).toBe(await readHelixdArtifactIdentity(dir))
      writeFileSync(join(dir, agentBrowserFilename), 'updated-browser')
      expect(computeHelixdFullVersion(dir, options)).not.toBe(withBrowser)
      expect(computeHelixdFullVersion(dir, options)).toBe(await readHelixdArtifactIdentity(dir))
    }
  )
})
