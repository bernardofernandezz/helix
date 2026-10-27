import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { shellQuote, sshArgs, type CommandRunner } from './host-command.js'
import type { HttpClient } from './http-client.js'
import { createHelixMcpServer, type HelixMcpOptions } from './server.js'
import { parseSacct, parseSbatchJobId, parseSqueue } from './slurm-output-parsing.js'

const unusedHttp: HttpClient = {
  getJson: async () => {
    throw new Error('unexpected request')
  },
  getText: async () => {
    throw new Error('unexpected request')
  },
  postJson: async () => {
    throw new Error('unexpected request')
  }
}

async function connect(options: Partial<HelixMcpOptions>) {
  const server = createHelixMcpServer({
    offline: false,
    allowSlurmWrite: false,
    http: unusedHttp,
    ...options
  })
  const client = new Client({ name: 'test', version: '0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

async function toolNames(options: Partial<HelixMcpOptions>): Promise<string[]> {
  const client = await connect(options)
  return (await client.listTools()).tools.map((tool) => tool.name)
}

function firstText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = Array.isArray(result.content) ? result.content : []
  const first: unknown = content[0]
  return typeof first === 'object' && first !== null && 'text' in first ? String(first.text) : ''
}

describe('tool registration', () => {
  it('exposes no public-database tool in sensitive-data mode', async () => {
    const names = await toolNames({ offline: true })
    expect(names.some((name) => /pubmed|ncbi|uniprot|pdb|alphafold|ensembl/.test(name))).toBe(false)
    expect(names).toContain('slurm_queue')
  })

  it('only exposes SLURM submit and cancel when allowed', async () => {
    expect(await toolNames({})).not.toContain('slurm_submit')
    expect(await toolNames({ allowSlurmWrite: true })).toEqual(
      expect.arrayContaining(['slurm_submit', 'slurm_cancel'])
    )
  })
})

describe('pubmed_search', () => {
  it('maps E-utilities summaries to citations', async () => {
    const http: HttpClient = {
      ...unusedHttp,
      getJson: async (url) => {
        const target = new URL(url)
        if (target.pathname.endsWith('esearch.fcgi')) {
          return { esearchresult: { count: '1', idlist: ['123'] } }
        }
        return {
          result: {
            uids: ['123'],
            '123': {
              uid: '123',
              title: 'A study',
              pubdate: '2025 Jan',
              fulljournalname: 'Nature',
              authors: [{ name: 'Silva A' }],
              articleids: [{ idtype: 'doi', value: '10.1/x' }]
            }
          }
        }
      }
    }
    const client = await connect({ http })
    const result = await client.callTool({ name: 'pubmed_search', arguments: { query: 'p53' } })
    const payload = JSON.parse(firstText(result))
    expect(payload.source).toContain('PubMed')
    expect(payload.data.results).toEqual([
      {
        pmid: '123',
        title: 'A study',
        authors: ['Silva A'],
        journal: 'Nature',
        published: '2025 Jan',
        doi: '10.1/x',
        url: 'https://pubmed.ncbi.nlm.nih.gov/123/'
      }
    ])
  })
})

describe('SLURM over SSH', () => {
  it('runs squeue through ssh in batch mode', async () => {
    const calls: { file: string; args: string[] }[] = []
    const runner: CommandRunner = async (file, args) => {
      calls.push({ file, args })
      return '42|align|RUNNING|1:00|4:00:00|1|short|node7\n'
    }
    const client = await connect({ runner })
    const result = await client.callTool({ name: 'slurm_queue', arguments: { host: 'hpc' } })
    expect(calls[0]?.file).toBe('ssh')
    expect(calls[0]?.args.slice(0, 5)).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=15',
      'hpc'
    ])
    expect(JSON.parse(firstText(result))[0]).toMatchObject({
      jobId: '42',
      state: 'RUNNING',
      reason: 'node7'
    })
  })

  it('rejects hosts that ssh would read as options', async () => {
    expect(() => sshArgs('-oProxyCommand=evil', 'true')).toThrow('invalid SSH host')
    const client = await connect({ runner: async () => '' })
    const result = await client.callTool({
      name: 'slurm_queue',
      arguments: { host: '-oProxyCommand=evil' }
    })
    expect(result.isError).toBe(true)
  })

  it('quotes remote paths for the remote shell', () => {
    expect(shellQuote("it's here; rm -rf /")).toBe(`'it'\\''s here; rm -rf /'`)
  })

  it('parses sacct and sbatch output', () => {
    expect(
      parseSacct('42|align|short|COMPLETED|00:10:00|04:00:00|8|32G|20G|0:0|node7')[0]
    ).toMatchObject({
      JobID: '42',
      State: 'COMPLETED',
      MaxRSS: '20G'
    })
    expect(parseSbatchJobId('4242;cluster\n')).toBe('4242')
    expect(() => parseSbatchJobId('sbatch: error: invalid partition')).toThrow('job id')
    expect(parseSqueue('')).toEqual([])
  })
})

describe('local workflow state', () => {
  it('reads the newest Snakemake log and the Nextflow history from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-mcp-'))
    await mkdir(join(dir, '.snakemake', 'log'), { recursive: true })
    await writeFile(join(dir, '.snakemake', 'log', 'a.snakemake.log'), '1 of 4 steps (25%) done\n')
    await mkdir(join(dir, '.nextflow'), { recursive: true })
    await writeFile(
      join(dir, '.nextflow', 'history'),
      '2026-10-01 10:00:00\t2m\tfirst_run\tOK\tr1\ts1\tnextflow run a.nf\n' +
        '2026-10-02 10:00:00\t-\tsecond_run\t-\tr1\ts2\tnextflow run a.nf -resume\n'
    )
    const client = await connect({})
    const snakemake = JSON.parse(
      firstText(
        await client.callTool({ name: 'snakemake_progress', arguments: { workflow_dir: dir } })
      )
    )
    expect(snakemake).toMatchObject({ state: 'running', stepsDone: 1, stepsTotal: 4 })
    const runs = JSON.parse(
      firstText(await client.callTool({ name: 'nextflow_runs', arguments: { project_dir: dir } }))
    )
    expect(runs.map((run: { runName: string }) => run.runName)).toEqual(['second_run', 'first_run'])
  })
})
