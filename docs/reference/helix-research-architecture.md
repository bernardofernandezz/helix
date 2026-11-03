# Helix research architecture

Helix began as a fork of a coding ADE. Its isolation unit was the git worktree, and review was done on diffs. Helix keeps that ADE's orchestration, terminal, status and remote layers. It replaces the core around them:

- The **Research Workspace** is the isolation unit.
- Results, figures, QC reports and provenance are the artifacts under review.

## Decisions

| #   | Decision                                                                                                      | Reversible by                                    |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| D1  | v1 isolation is a folder plus a pinned env. Containers come later, as an optional runtime.                    | Adding a runtime behind the same workspace shape |
| D2  | Compute runs locally and on the existing SSH/helixd remote. Slurm is a tool, not core.                        | —                                                |
| D3  | Agents are the existing CLIs. Native chat (structured sessions) is the primary research surface.              | —                                                |
| D4  | Provenance is an append-only JSONL log. Large data is referenced by path and hash, never copied.              | Exporting to RO-Crate                            |
| D5  | Each new workspace in a folder project gets `analyses/<slug>/`. The root workspace stays at the project root. | Unset `WorktreeMeta.analysisDir`                 |
| D6  | Research metadata lives on disk under `.helix/`, with no SQLite schema change.                                | —                                                |
| D7  | Env pinning uses `pixi.toml` and `pixi.lock`.                                                                 | —                                                |
| D8  | Coding UI is hidden for research projects. Forge integrations are deleted later.                              | Settings toggles                                 |
| D9  | The helix-mcp `run_step` tool writes provenance.                                                              | —                                                |
| D10 | Review is a Results panel plus "Promote" to `RESEARCH_LOG.md`. Claims stay in markdown.                       | —                                                |
| D11 | Research tooling (helix-mcp, provenance) is local-only in v1.                                                 | Deploying helix-mcp with helixd                  |
| D12 | An analysis folder's slug is fixed at creation. Removing a workspace never deletes its folder.                | —                                                |

Rejected: a third `RepoKind`. `getRepoKind` maps unknown values to `'git'`, so an older host would run git operations on a research folder.

## Shape

```
Project (folder repo) ── pixi.toml/.lock · data/raw · RESEARCH_LOG.md · .helix/
  ├─ root workspace (overview, cwd = project root)
  └─ Research Workspace × N = analyses/<slug>/ { results/ · .helix/provenance.jsonl }
Agent fleet ── launch pipeline + structured sessions + status/dashboard   [kept]
Bio tools   ── helix-mcp (NCBI/UniProt/Ensembl/PDB/Nextflow/Slurm + run_step) + bio skills
Review      ── Results panel → existing viewers → Promote → RESEARCH_LOG.md
Terminal    ── daemon/PTY/helixd remote                                   [kept]
```

## Keep / Adapt / Replace

| Area                                                             | Verdict                                        |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| Terminal daemon, PTY providers, helixd/SSH, protocol-compat      | Keep                                           |
| Agent status, dashboard, notifications, launch pipeline          | Keep                                           |
| Structured sessions / native chat                                | Keep (the research agent)                      |
| Viewer registry, bio viewers, notebook kernel                    | Keep and extend                                |
| Research scaffold, helix-mcp, folder workspaces                  | Adapt                                          |
| Activity page, markdown review notes, diff/image-diff            | Adapt into a research log and result compare   |
| Git worktree lifecycle, Source Control panel                     | Keep as an optional backend, hidden by default |
| PR page, Checks, GitHub/GitLab/Bitbucket/Gitea/Azure/Jira/Linear | Replace: hide now, delete later                |

## Sequence

1. Analysis subfolders (D5)
2. Scaffold: pixi, `.helix/`, `RESEARCH_LOG.md` (D6, D7)
3. Provenance through `run_step` (D4, D9)
4. Hide the remaining coding UI behind one setting (D8)
5. Results panel and Promote (D10)
