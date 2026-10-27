import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerEnsemblTools } from './ensembl-tools.js'
import { runCommand, type CommandRunner } from './host-command.js'
import { createHttpClient, type HttpClient } from './http-client.js'
import { createEntrezClient, registerNcbiTools, type NcbiCredentials } from './ncbi-tools.js'
import { registerPipelineTools } from './pipeline-tools.js'
import { registerStructureTools } from './structure-tools.js'
import { registerUniprotTools } from './uniprot-tools.js'

export const HELIX_MCP_VERSION = '0.1.0'

export type HelixMcpOptions = {
  // Sensitive-data projects: no tool may reach a public database.
  offline: boolean
  allowSlurmWrite: boolean
  ncbi?: NcbiCredentials
  http?: HttpClient
  runner?: CommandRunner
}

const INSTRUCTIONS = `Helix research tools.
- Cite what you use: PMIDs/DOIs for papers, accessions (UniProt, RefSeq, PDB, Ensembl) for records. Database answers include "source" and "retrievedAt"; keep them for the methods section.
- Prefer reviewed UniProt entries and canonical Ensembl transcripts unless the user asks otherwise.
- Pipeline and SLURM tools read state; launch pipelines in a terminal. Submitting or cancelling SLURM jobs needs the user's approval.`

const OFFLINE_INSTRUCTIONS = `${INSTRUCTIONS}
- This project is in sensitive-data mode: public database tools are disabled. Do not send project data to external services.`

export function createHelixMcpServer(options: HelixMcpOptions): McpServer {
  const server = new McpServer(
    { name: 'helix-research', version: HELIX_MCP_VERSION },
    { instructions: options.offline ? OFFLINE_INSTRUCTIONS : INSTRUCTIONS }
  )
  if (!options.offline) {
    const http = options.http ?? createHttpClient()
    registerNcbiTools(server, createEntrezClient(http, options.ncbi ?? {}))
    registerUniprotTools(server, http)
    registerStructureTools(server, http)
    registerEnsemblTools(server, http)
  }
  registerPipelineTools(server, {
    runner: options.runner ?? runCommand,
    allowSlurmWrite: options.allowSlurmWrite
  })
  return server
}
