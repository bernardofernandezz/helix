import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = join(import.meta.dirname, 'build-helix-mcp.mjs')
const HANDSHAKE = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '0' }
    }
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' }
]
  .map((message) => JSON.stringify(message))
  .join('\n')

let outDir

function listTools(args) {
  const stdout = execFileSync(process.execPath, [join(outDir, 'helix-mcp.mjs'), ...args], {
    input: `${HANDSHAKE}\n`,
    encoding: 'utf8',
    timeout: 20_000
  })
  const reply = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 2)
  return reply.result.tools.map((tool) => tool.name)
}

describe('helix-mcp bundle', () => {
  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'helix-mcp-bundle-'))
    execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, HELIX_MCP_OUT_DIR: outDir } })
  }, 60_000)

  afterAll(() => rmSync(outDir, { recursive: true, force: true }))

  it('runs self-contained and serves the research tools over stdio', () => {
    expect(listTools([])).toEqual(
      expect.arrayContaining([
        'pubmed_search',
        'uniprot_entry',
        'alphafold_prediction',
        'slurm_queue'
      ])
    )
  })

  it('drops public-database tools in offline mode', () => {
    const tools = listTools(['--offline'])
    expect(tools).not.toContain('pubmed_search')
    expect(tools).toContain('snakemake_progress')
  })
})
