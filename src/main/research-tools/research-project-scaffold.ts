import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  HELIX_RESEARCH_MCP_SERVER_NAME,
  type ResearchProjectSetupResult
} from '../../shared/research-project-types'
import type { HelixMcpServerEntry } from './helix-mcp-server-entry'

const PROJECT_DIRS = ['data/raw', 'data/processed', 'notebooks', 'workflows', 'results']

export class InvalidMcpConfigError extends Error {}

/** Adds or refreshes the helix-research server, keeping every other server and key as written. */
export function mergeResearchServer(existing: string | null, entry: HelixMcpServerEntry): string {
  let config: Record<string, unknown> = {}
  if (existing !== null && existing.trim() !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(existing)
    } catch {
      throw new InvalidMcpConfigError(
        '.mcp.json is not valid JSON; fix it before adding research tools.'
      )
    }
    if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
      throw new InvalidMcpConfigError('.mcp.json must be an object with an "mcpServers" object.')
    }
    config = parsed
  }
  const servers = isRecord(config.mcpServers) ? config.mcpServers : {}
  return `${JSON.stringify(
    { ...config, mcpServers: { ...servers, [HELIX_RESEARCH_MCP_SERVER_NAME]: entry } },
    null,
    2
  )}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Conda env names allow letters, digits, `_`, `-` and `.`; anything else becomes `-`. */
export function condaEnvironmentNameFor(projectDir: string): string {
  const slug = basename(projectDir)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'research'
}

export function environmentFileFor(projectDir: string): string {
  return `name: ${condaEnvironmentNameFor(projectDir)}
channels:
  - conda-forge
  - bioconda
dependencies:
  - python=3.12
  - ipykernel
  - numpy
  - pandas
  - matplotlib
  - scipy
  - biopython
`
}

function readmeFor(projectDir: string): string {
  return `# ${basename(projectDir)}

| Folder           | Holds                                                     |
| ---------------- | --------------------------------------------------------- |
| \`data/raw\`       | Input data exactly as received. Never edit these files.   |
| \`data/processed\` | Data produced by notebooks or workflows from \`data/raw\`. |
| \`notebooks\`      | Exploratory analysis.                                     |
| \`workflows\`      | Nextflow or Snakemake pipelines.                          |
| \`results\`        | Figures, tables and reports.                              |

Create the environment with \`conda env create -f environment.yml\`. Agents in this project can use the
Helix research tools (PubMed, NCBI, UniProt, PDB, AlphaFold, Ensembl, Nextflow, Snakemake, SLURM)
configured in \`.mcp.json\`.
`
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function writeIfMissing(path: string, content: string): Promise<boolean> {
  try {
    // `wx` fails when the file exists, so concurrent edits are never overwritten.
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return false
    }
    throw error
  }
}

/** Lays out a research project in an existing folder and points its agents at helix-mcp. */
export async function setUpResearchProject(
  projectDir: string,
  entry: HelixMcpServerEntry
): Promise<ResearchProjectSetupResult> {
  const mcpPath = join(projectDir, '.mcp.json')
  const existing = await readOptional(mcpPath)
  let merged: string
  try {
    merged = mergeResearchServer(existing, entry)
  } catch (error) {
    if (error instanceof InvalidMcpConfigError) {
      return { ok: false, reason: 'invalid-mcp-config', detail: error.message }
    }
    throw error
  }

  const created: string[] = []
  for (const dir of PROJECT_DIRS) {
    if ((await mkdir(join(projectDir, ...dir.split('/')), { recursive: true })) !== undefined) {
      created.push(`${dir}/`)
    }
  }
  if (await writeIfMissing(join(projectDir, 'environment.yml'), environmentFileFor(projectDir))) {
    created.push('environment.yml')
  }
  if (await writeIfMissing(join(projectDir, 'README.md'), readmeFor(projectDir))) {
    created.push('README.md')
  }
  const mcpConfigUpdated = merged !== existing
  if (mcpConfigUpdated) {
    await writeFile(mcpPath, merged, 'utf8')
    if (existing === null) {
      created.push('.mcp.json')
    }
  }
  return { ok: true, created, mcpConfigUpdated }
}
