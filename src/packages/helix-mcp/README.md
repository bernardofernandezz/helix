# helix-mcp

An MCP server (stdio) that gives research agents the databases and compute a life-science project
needs. Every database answer carries its `source` and `retrievedAt`, so agents can cite what they used.

| Area        | Tools                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Literature  | `pubmed_search`, `pubmed_fetch_abstracts`                                                          |
| NCBI        | `ncbi_search` (gene, nucleotide, protein, taxonomy, SRA, ClinVar, dbSNP, …), `ncbi_fetch_sequence` |
| Proteins    | `uniprot_search`, `uniprot_entry`                                                                  |
| Structures  | `pdb_search`, `pdb_entry`, `alphafold_prediction`                                                  |
| Genomics    | `ensembl_lookup`, `ensembl_variant_effect` (VEP), `ensembl_sequence`                               |
| Pipelines   | `nextflow_runs`, `nextflow_trace_summary`, `snakemake_progress` (local or over SSH)                |
| HPC (SLURM) | `slurm_queue`, `slurm_job`; `slurm_submit`, `slurm_cancel` with `--allow-slurm-write`              |

## Run

```bash
pnpm --filter @helix/mcp build
node src/packages/helix-mcp/dist/cli.js --help
```

Options:

- `--offline` (or `HELIX_MCP_OFFLINE=1`): sensitive-data mode. No public-database tool is registered;
  pipeline and SLURM tools stay available.
- `--allow-slurm-write`: exposes `slurm_submit` and `slurm_cancel`. Agents are told to ask before using them.
- `NCBI_API_KEY`, `NCBI_EMAIL`: raise the NCBI limit from 3 to 10 requests per second.

## Connect an agent

Project-level `.mcp.json` (Claude Code, Cursor and others read it):

```json
{
  "mcpServers": {
    "helix-research": {
      "command": "node",
      "args": ["/path/to/helix/src/packages/helix-mcp/dist/cli.js"]
    }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.helix-research]
command = "node"
args = ["/path/to/helix/src/packages/helix-mcp/dist/cli.js"]
```

## SSH and SLURM

Remote tools call the system `ssh` with `BatchMode=yes`, so they use your keys, agent and
`~/.ssh/config` aliases and never prompt. Set up key login to the cluster first (`ssh hpc true` must
succeed without a prompt). Host names are validated so they cannot be read as `ssh` options, and every
remote path is shell-quoted.
