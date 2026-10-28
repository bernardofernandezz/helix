import { HELIX_RESEARCH_MCP_SERVER_NAME } from '../../research-project-types'
import type { NativeChatMcpIdentity } from './native-chat-tool-identity'

const RESEARCH_SOURCES: Record<string, string> = {
  pubmed: 'PubMed',
  uniprot: 'UniProt',
  ncbi: 'NCBI',
  ensembl: 'Ensembl',
  clinvar: 'ClinVar',
  pdb: 'PDB',
  alphafold: 'AlphaFold',
  slurm: 'Slurm',
  snakemake: 'Snakemake',
  nextflow: 'Nextflow'
}

/** Name a research tool by its database or scheduler: `pubmed_search` reads as PubMed / search. */
export function researchToolSource(identity: NativeChatMcpIdentity): NativeChatMcpIdentity | null {
  if (identity.server !== HELIX_RESEARCH_MCP_SERVER_NAME) {
    return null
  }
  const [prefix, ...rest] = identity.tool.split('_')
  const source = RESEARCH_SOURCES[prefix]
  if (!source) {
    return null
  }
  return { server: source, tool: rest.length > 0 ? rest.join(' ') : identity.tool }
}
