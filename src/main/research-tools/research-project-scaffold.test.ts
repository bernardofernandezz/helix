import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  condaEnvironmentNameFor,
  mergeResearchServer,
  setUpResearchProject
} from './research-project-scaffold'

const ENTRY = {
  command: '/Applications/Helix.app/helix',
  args: ['/r/helix-mcp.mjs'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

let dir: string | null = null
afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = null
  }
})

async function project(name = 'RNA-seq 2026'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'helix-research-'))
  dir = root
  const projectDir = join(root, name)
  await mkdir(projectDir)
  return projectDir
}

describe('mergeResearchServer', () => {
  it('keeps other servers and keys while adding helix-research', () => {
    const merged = JSON.parse(
      mergeResearchServer('{"$schema":"x","mcpServers":{"github":{"command":"gh"}}}', ENTRY)
    )
    expect(merged).toEqual({
      $schema: 'x',
      mcpServers: { github: { command: 'gh' }, 'helix-research': ENTRY }
    })
  })

  it('refuses to rewrite invalid or misshapen configs', () => {
    expect(() => mergeResearchServer('{ nope', ENTRY)).toThrow('not valid JSON')
    expect(() => mergeResearchServer('{"mcpServers":[]}', ENTRY)).toThrow('"mcpServers" object')
    expect(() => mergeResearchServer('[]', ENTRY)).toThrow('"mcpServers" object')
  })
})

describe('setUpResearchProject', () => {
  it('lays out the project once and never overwrites existing files', async () => {
    const projectDir = await project()
    await writeFile(join(projectDir, 'README.md'), 'my notes\n')

    const first = await setUpResearchProject(projectDir, ENTRY)
    expect(first).toEqual({
      ok: true,
      created: [
        'data/raw/',
        'data/processed/',
        'notebooks/',
        'workflows/',
        'results/',
        'environment.yml',
        '.mcp.json'
      ],
      mcpConfigUpdated: true
    })
    expect(await readFile(join(projectDir, 'README.md'), 'utf8')).toBe('my notes\n')
    expect(await readFile(join(projectDir, 'environment.yml'), 'utf8')).toContain(
      'name: rna-seq-2026'
    )

    const second = await setUpResearchProject(projectDir, ENTRY)
    expect(second).toEqual({ ok: true, created: [], mcpConfigUpdated: false })
  })

  it('leaves an invalid .mcp.json and the folder untouched', async () => {
    const projectDir = await project()
    await writeFile(join(projectDir, '.mcp.json'), '{ broken')
    const result = await setUpResearchProject(projectDir, ENTRY)
    expect(result).toMatchObject({ ok: false, reason: 'invalid-mcp-config' })
    expect(await readFile(join(projectDir, '.mcp.json'), 'utf8')).toBe('{ broken')
    await expect(readFile(join(projectDir, 'environment.yml'), 'utf8')).rejects.toThrow()
  })

  it('derives a valid conda env name from the folder', () => {
    expect(condaEnvironmentNameFor('/p/Tumor vs Normal (v2)')).toBe('tumor-vs-normal-v2')
    expect(condaEnvironmentNameFor('/p/@@@')).toBe('research')
  })
})
