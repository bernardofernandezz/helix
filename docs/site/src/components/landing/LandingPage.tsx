import Link from 'next/link'
import {
  BookOpenText,
  Cpu,
  Database,
  FlaskConical,
  Lock,
  MessagesSquare,
  Table2,
  Workflow
} from 'lucide-react'
import type { ReactNode } from 'react'
import { BasePairRule, HelixMark } from './HelixMark'

const REPO_URL = 'https://github.com/bernardofernandezz/helix'

const TRANSCRIPT: { tool: string; args: string; result: string; source: string }[] = [
  {
    tool: 'pubmed_search',
    args: '"TP53 R175H" structure',
    result: 'papers with PMID and DOI',
    source: 'PubMed'
  },
  {
    tool: 'uniprot_entry',
    args: 'P04637',
    result: 'function, PDB and AlphaFold links',
    source: 'UniProtKB'
  },
  {
    tool: 'ensembl_variant_effect',
    args: 'rs28934578',
    result: 'consequence, SIFT, PolyPhen',
    source: 'Ensembl VEP'
  },
  {
    tool: 'slurm_job',
    args: 'hpc · 4815162',
    result: 'state, elapsed, peak memory',
    source: 'sacct over SSH'
  }
]

const AUDIENCES = [
  {
    title: 'Biologists and biotechnologists',
    body: 'Ask in plain language. The agent reads your tables, runs the analysis and explains the result, without you living in a terminal.'
  },
  {
    title: 'Bioinformaticians',
    body: 'Run Nextflow and Snakemake on your laptop or cluster, and let agents launch, watch and debug those runs with you.'
  },
  {
    title: 'Research groups',
    body: 'Every database answer carries its source and retrieval time, so analyses can be audited, cited and repeated.'
  }
]

type Capability = { icon: ReactNode; title: string; body: string; status?: 'Planned' }

const CAPABILITIES: Capability[] = [
  {
    icon: <BookOpenText className="size-4" />,
    title: 'Literature and databases',
    body: 'PubMed, NCBI, UniProt, PDB, AlphaFold DB and Ensembl as agent tools through helix-mcp.'
  },
  {
    icon: <Workflow className="size-4" />,
    title: 'Pipelines and clusters',
    body: 'Nextflow runs and traces, Snakemake progress and SLURM jobs, local or over SSH.'
  },
  {
    icon: <MessagesSquare className="size-4" />,
    title: 'Agents side by side',
    body: 'Claude Code, Codex, Gemini CLI, OpenCode, Goose, Aider or any CLI agent, each with live status.'
  },
  {
    icon: <Table2 className="size-4" />,
    title: 'Data and notebooks',
    body: 'Grid viewer for CSV and TSV, Jupyter notebooks with real kernels, PDF, Markdown and images.'
  },
  {
    icon: <Lock className="size-4" />,
    title: 'Sensitive data mode',
    body: 'Run helix-mcp offline so no public-database tool can send project data to an external service.'
  },
  {
    icon: <FlaskConical className="size-4" />,
    title: 'Reproducibility',
    body: 'A provenance ledger, an auto-generated methods section and RO-Crate export.',
    status: 'Planned'
  }
]

const AGENTS = ['Claude Code', 'Codex', 'Gemini CLI', 'OpenCode', 'Goose', 'Aider']

function Readout({ items }: { items: string[] }) {
  return (
    <p className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">
      {items.join(' · ')}
    </p>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <HelixMark className="size-7 text-foreground" />
            <span className="text-sm font-semibold tracking-tight">HELIX</span>
          </Link>
          <nav aria-label="Primary navigation" className="flex items-center gap-1">
            <Link
              href="/docs"
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Docs
            </Link>
            <a
              href={REPO_URL}
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="landing-grid-field relative overflow-hidden border-b border-border">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 md:grid-cols-[1.1fr_1fr] md:py-28">
            <div className="flex flex-col justify-center gap-6">
              <Readout items={['Early preview', 'Open source', 'macOS · Windows · Linux']} />
              <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
                An agentic research environment for the life sciences.
              </h1>
              <p className="max-w-xl text-base text-muted-foreground md:text-lg">
                Run AI agents side by side on your research projects. Search the literature, query
                biological databases, drive genomic pipelines and watch your cluster jobs, with
                every answer cited.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/docs/install"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Build from source
                </Link>
                <Link
                  href="/docs"
                  className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Read the docs
                </Link>
              </div>
            </div>

            <figure
              aria-label="Example of an agent using Helix research tools"
              className="self-center rounded-xl border border-border bg-card shadow-floating"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <span className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">
                  Agent · helix-research
                </span>
                <span className="landing-live-dot size-2 rounded-full bg-primary" />
              </div>
              <ol className="divide-y divide-border">
                {TRANSCRIPT.map((step) => (
                  <li key={step.tool} className="flex flex-col gap-1 px-4 py-3">
                    <code className="font-mono text-[13px]">
                      <span className="text-primary">{step.tool}</span>{' '}
                      <span className="text-muted-foreground">{step.args}</span>
                    </code>
                    <span className="text-[13px] text-foreground">→ {step.result}</span>
                    <Readout items={[`Source: ${step.source}`]} />
                  </li>
                ))}
              </ol>
              <figcaption className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                Illustrative tool calls. Every answer keeps its source and retrieval time.
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-16">
          <SectionLabel>Who it is for</SectionLabel>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {AUDIENCES.map((audience) => (
              <div key={audience.title} className="flex flex-col gap-2">
                <h3 className="text-base font-semibold">{audience.title}</h3>
                <p className="text-sm text-muted-foreground">{audience.body}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mx-auto max-w-[1200px] px-4">
          <BasePairRule />
        </div>

        <section className="mx-auto max-w-[1200px] px-4 py-16">
          <SectionLabel>What you get</SectionLabel>
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((capability) => (
              <div key={capability.title} className="flex flex-col gap-2 bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="text-primary">{capability.icon}</span>
                  {capability.status ? (
                    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-3xs tracking-wider text-muted-foreground uppercase">
                      {capability.status}
                    </span>
                  ) : null}
                </div>
                <h3 className="text-sm font-semibold">{capability.title}</h3>
                <p className="text-sm text-muted-foreground">{capability.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-col gap-2">
            <Readout items={['PubMed', 'NCBI', 'UniProt', 'PDB', 'AlphaFold DB', 'Ensembl']} />
            <Readout items={['Nextflow', 'Snakemake', 'SLURM over SSH']} />
          </div>
        </section>

        <section className="border-y border-border bg-card">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-12 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Cpu className="size-4 text-primary" />
              <p className="text-sm">Bring the agents you already use.</p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {AGENTS.map((agent) => (
                <li
                  key={agent}
                  className="rounded-md border border-border px-3 py-1 font-mono text-xs text-muted-foreground"
                >
                  {agent}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-grid-field">
          <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-4 py-20 text-center">
            <HelixMark className="size-12 text-foreground" />
            <h2 className="text-2xl font-semibold tracking-tight">Start your first analysis.</h2>
            <p className="max-w-lg text-sm text-muted-foreground">
              There are no published builds yet. Build Helix from source in a few minutes, then
              connect the research tools to your agents.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/docs/install"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Install guide
              </Link>
              <Link
                href="/docs/research-tools"
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Database className="size-4" />
                Research tools
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Helix is open source under the MIT License.</span>
          <nav aria-label="Footer" className="flex gap-4">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            <a href={REPO_URL} className="hover:text-foreground">
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
