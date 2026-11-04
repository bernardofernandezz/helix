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

| Area               | What you get                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research projects  | New projects are plain folders with `data/`, `notebooks/`, `results/`, a bioconda `environment.yml` and the research tools wired in; git is optional. |
| Agents             | Claude Code, Codex, Gemini CLI, OpenCode, Goose, Aider and any other CLI agent, side by side, with live status.                                       |
| Chat surface       | Chat is the default: a new project opens straight into a chat with your agent, with approvals, math and inline plots and 3D structures.               |
| Data and notebooks | Viewers for FASTA, VCF/BED/GFF, PDB/mmCIF/SDF in 3D, CSV/TSV, Jupyter notebooks with real kernels, PDF and images.                                    |
| Remote compute     | SSH hosts for servers and clusters, with remote terminals and file browsing.                                                                          |
| Science skills     | Built-in agent skills for NGS QC, RNA-seq, variants, single-cell, sequence design (BLAST, primers, CRISPR), cheminformatics and reproducible methods. |
| Automation         | Scheduled agent runs, a scriptable `helix` CLI and installable agent skills.                                                                          |

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

Helix is in closed beta for **Windows and Linux** (macOS is coming once builds are notarized).
Download the installer from [GitHub Releases](https://github.com/bernardofernandezz/helix/releases):

- **Windows:** `helix-windows-setup.exe`. The beta is not code-signed yet, so SmartScreen warns on
  first launch: choose **More info → Run anyway**.
- **Linux:** the `.AppImage`, `.deb` or `.rpm` for x64.

Installed builds update themselves. Report problems in
[GitHub Issues](https://github.com/bernardofernandezz/helix/issues).

To build from source instead:

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
