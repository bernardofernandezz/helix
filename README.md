<h1 align="center">
  <img src="resources/build/icon.png" alt="Helix" width="64" valign="middle" /> Helix
</h1>

<p align="center">
  <strong>An agentic research environment for the life sciences.</strong><br/>
  Run AI agents side by side on your research projects: analyze data, search the literature,
  drive genomic pipelines and keep every step reproducible.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-2E7D6B?style=flat" alt="License: MIT" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-2E7D6B?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
  <img src="https://img.shields.io/badge/status-early%20preview-B5651D?style=flat-square" alt="Status: early preview" />
</p>

<p align="center">
  <sub><a href="docs/readme/README.pt.md">Português</a></sub>
</p>

---

## Who it is for

- **Biologists and biotechnologists** who want an assistant that reads their tables, runs the
  analysis and explains the result, without living in a terminal.
- **Bioinformaticians** who run Nextflow or Snakemake pipelines, work on HPC clusters and want
  agents that can launch, watch and debug those runs.
- **Research groups** that need analyses others can audit and repeat.

## What works today

| Area               | What you get                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Research projects  | Each project is a folder (or a git worktree when you use git) with its own agents, terminals and files.         |
| Agents             | Claude Code, Codex, Gemini CLI, OpenCode, Goose, Aider and any other CLI agent, side by side, with live status. |
| Chat surface       | A structured chat view with tool calls, approvals, tables, math and inline charts.                              |
| Data and notebooks | Grid viewer for CSV/TSV, Jupyter notebooks with real kernels, PDF, Markdown and images.                         |
| Remote compute     | SSH hosts for servers and clusters, with remote terminals and file browsing.                                    |
| Automation         | Scheduled agent runs, a scriptable `helix` CLI and installable agent skills.                                    |

## Roadmap

1. **First analysis without a terminal.** The chat opens by default, with research project templates,
   conda environment detection and viewers for VCF, BED, GFF and FASTA.
2. **Scientific tools for agents.** Skills and MCP servers for PubMed, NCBI, UniProt, PDB/AlphaFold
   and Ensembl, plus common tools such as BLAST, samtools and bcftools.
3. **Sensitive data mode.** Local models only, no external network calls and a visible badge, enforced
   per project.
4. **Pipelines and HPC.** Nextflow and Snakemake progress panels, and SLURM job tracking over SSH.
5. **Reproducibility.** A provenance ledger of commands, versions and database releases, an
   auto-generated methods section and RO-Crate export.

The mobile companion is not part of the first release. See
[docs/reference/mobile-connection.md](docs/reference/mobile-connection.md).

## Install

There are no published builds yet. Build from source:

```bash
git clone https://github.com/bernardofernandezz/helix.git
cd helix
pnpm install
pnpm dev
```

Requirements: Node.js 24+, pnpm, and the platform build tools for native modules (Xcode command line
tools on macOS, `build-essential` on Linux, Visual Studio Build Tools on Windows).

## Developing

- Contribution guide: [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)
- Before opening a pull request: `pnpm check:changed --maxWorkers=2`
- Typecheck: `pnpm tc` · Tests: `pnpm test` · Lint: `pnpm lint`

## License

Helix is open source under the [MIT License](LICENSE).

# helix
