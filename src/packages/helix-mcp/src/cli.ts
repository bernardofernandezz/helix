#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { HELIX_MCP_VERSION, createHelixMcpServer } from './server.js'

const USAGE = `helix-mcp ${HELIX_MCP_VERSION} — research tools for AI agents over MCP (stdio)

Usage: helix-mcp [--offline] [--allow-slurm-write]

  --offline            Disable every public-database tool (sensitive-data projects)
  --allow-slurm-write  Expose slurm_submit and slurm_cancel

Environment:
  NCBI_API_KEY         Raises the NCBI rate limit from 3 to 10 requests per second
  NCBI_EMAIL           Contact address NCBI asks E-utilities clients to send
  HELIX_MCP_OFFLINE=1  Same as --offline`

const { values } = parseArgs({
  options: {
    offline: { type: 'boolean', default: false },
    'allow-slurm-write': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false }
  }
})

if (values.help) {
  console.log(USAGE)
} else if (values.version) {
  console.log(HELIX_MCP_VERSION)
} else {
  const server = createHelixMcpServer({
    offline: values.offline || process.env.HELIX_MCP_OFFLINE === '1',
    allowSlurmWrite: values['allow-slurm-write'],
    ncbi: { apiKey: process.env.NCBI_API_KEY, email: process.env.NCBI_EMAIL }
  })
  await server.connect(new StdioServerTransport())
}
