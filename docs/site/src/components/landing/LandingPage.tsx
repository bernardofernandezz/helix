import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Lock, Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { GithubMark } from '@/components/layout/GithubMark'
import { REPO_URL } from '@/lib/helix-links'
import { BasePairRule, HelixMark } from './HelixMark'
import { DownloadButton } from './DownloadButton'
import { ProductMockup } from './ProductMockup'

const secondaryButton =
  'inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-5 text-[15px] font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'

function Readout({ items }: { items: string[] }) {
  return (
    <p className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">
      {items.join(' · ')}
    </p>
  )
}

function GridField() {
  return (
    <div aria-hidden="true" className="landing-grid-field pointer-events-none absolute inset-0" />
  )
}

function SectionHeading({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h2 className="text-3xl font-semibold tracking-[-0.03em] text-balance md:text-5xl">
        {title}
      </h2>
      {body ? <p className="text-base text-muted-foreground md:text-lg">{body}</p> : null}
    </div>
  )
}

function SourceVisual() {
  const rows = [
    ['PubMed', '23 papers', '14:56'],
    ['UniProtKB', 'P04637', '14:57'],
    ['Ensembl VEP', 'rs28934578', '14:57']
  ]
  return (
    <ul className="flex w-full flex-col gap-1.5">
      {rows.map(([source, value, time]) => (
        <li
          key={source}
          className="flex items-center justify-between rounded-md border border-border bg-background/60 px-2.5 py-1.5 font-mono text-2xs"
        >
          <span>{source}</span>
          <span className="text-muted-foreground">
            {value} · {time}
          </span>
        </li>
      ))}
    </ul>
  )
}

function PipelineVisual() {
  const rows = [
    ['STAR_ALIGN', 70],
    ['SALMON_QUANT', 38],
    ['MULTIQC', 0]
  ] as const
  return (
    <ul className="flex w-full flex-col gap-2.5 font-mono text-2xs">
      {rows.map(([name, pct]) => (
        <li key={name} className="grid grid-cols-[92px_1fr] items-center gap-3">
          <span className="truncate text-muted-foreground">{name}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-accent">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </span>
        </li>
      ))}
      <li className="text-muted-foreground">slurm · 48 jobs · RUNNING</li>
    </ul>
  )
}

const BASE_COLOR: Record<string, string> = {
  A: 'text-brand',
  T: 'text-annotation-highlight',
  G: 'text-foreground',
  C: 'text-muted-foreground'
}

function SequenceVisual() {
  const seq = 'ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTGAGTCAGGAAACATTTTCAGACCTATGGAAA'
  return (
    <div className="w-full">
      <p className="mb-2 font-mono text-2xs text-muted-foreground">&gt;NM_000546.6 TP53</p>
      <p className="font-mono text-xs leading-relaxed tracking-[0.12em] break-all">
        {seq.split('').map((base, i) => (
          <span key={i} className={BASE_COLOR[base]}>
            {base}
          </span>
        ))}
      </p>
    </div>
  )
}

function AgentsVisual() {
  const agents = [
    ['Claude Code', 'working'],
    ['Codex', 'done'],
    ['Gemini CLI', 'idle']
  ]
  return (
    <ul className="flex w-full flex-col gap-1.5">
      {agents.map(([name, state]) => (
        <li
          key={name}
          className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs"
        >
          <span
            className={
              state === 'working'
                ? 'landing-live-dot size-1.5 rounded-full bg-brand'
                : 'size-1.5 rounded-full bg-muted-foreground/40'
            }
          />
          {name}
          <span className="ml-auto font-mono text-3xs tracking-wider text-muted-foreground uppercase">
            {state}
          </span>
        </li>
      ))}
    </ul>
  )
}

function OfflineVisual() {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background/60">
        <Lock className="size-4 text-brand" aria-hidden="true" />
      </span>
      <code className="rounded-md border border-border bg-background/60 px-2.5 py-1 font-mono text-2xs">
        helix-mcp --offline
      </code>
      <span className="font-mono text-3xs tracking-wider text-muted-foreground uppercase">
        Public databases · off
      </span>
    </div>
  )
}

function DataVisual() {
  const rows = [
    ['gene', 'log2FC', 'padj'],
    ['CYP3A4', '−2.41', '1e-12'],
    ['ALB', '0.18', '0.62'],
    ['APOA1', '1.97', '3e-08']
  ]
  return (
    <table className="w-full font-mono text-2xs">
      <tbody>
        {rows.map((row, i) => (
          <tr key={row[0]} className={i === 0 ? 'text-muted-foreground' : undefined}>
            {row.map((cell, j) => (
              <td
                key={j}
                className={`border border-border px-2 py-1 ${j > 0 ? 'text-right' : ''} ${i > 0 && j === 0 ? 'italic' : ''}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SkillsVisual() {
  const skills = [
    'ngs-qc-alignment',
    'rnaseq-differential-expression',
    'single-cell-analysis',
    'variant-analysis'
  ]
  return (
    <ul className="flex w-full flex-col gap-1 font-mono text-2xs">
      {skills.map((skill) => (
        <li key={skill} className="flex items-center gap-2 truncate">
          <Check className="size-3 shrink-0 text-brand" aria-hidden="true" />
          {skill}
        </li>
      ))}
      <li className="pl-5 text-muted-foreground">+ sequence-design, cheminformatics</li>
    </ul>
  )
}

function ProvenanceVisual() {
  return (
    <ul className="flex w-full flex-col gap-1.5 font-mono text-2xs text-muted-foreground">
      <li>salmon 1.10.3 · bioconda</li>
      <li>GRCh38 · Ensembl 113</li>
      <li>nf-core/rnaseq 3.18.0</li>
      <li className="text-foreground">→ methods.md · ro-crate.zip</li>
    </ul>
  )
}

type Feature = { title: string; body: string; visual: ReactNode; planned?: boolean }

const FEATURES: Feature[] = [
  {
    title: 'Literature and databases',
    body: 'PubMed, NCBI, UniProt, PDB, AlphaFold DB and Ensembl as agent tools, with every answer cited.',
    visual: <SourceVisual />
  },
  {
    title: 'Pipelines and clusters',
    body: 'Nextflow runs and traces, Snakemake progress and SLURM jobs, on your laptop or over SSH.',
    visual: <PipelineVisual />
  },
  {
    title: 'Viewers for biological files',
    body: 'FASTA, VCF, BED and GFF, PDB, mmCIF and SDF in 3D, opened right next to the conversation.',
    visual: <SequenceVisual />
  },
  {
    title: 'Agents side by side',
    body: 'Claude Code, Codex, Gemini CLI and any CLI agent, each with live status and a real terminal.',
    visual: <AgentsVisual />
  },
  {
    title: 'Data and notebooks',
    body: 'A grid viewer for CSV and TSV, Jupyter notebooks with real kernels, PDFs and images.',
    visual: <DataVisual />
  },
  {
    title: 'Science skills built in',
    body: 'Agent skills for NGS QC, RNA-seq, variants, single-cell, sequence design and cheminformatics.',
    visual: <SkillsVisual />
  },
  {
    title: 'Sensitive data mode',
    body: 'Run the research tools offline so no public-database call can send project data outside.',
    visual: <OfflineVisual />
  },
  {
    title: 'Reproducibility',
    body: 'A provenance ledger, an auto-generated methods section and RO-Crate export.',
    visual: <ProvenanceVisual />,
    planned: true
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

const AGENTS = ['Claude Code', 'Codex', 'Gemini CLI', 'OpenCode', 'Goose', 'Aider', 'Any CLI agent']

const COMPARISON: { row: string; other: string | null }[] = [
  { row: 'Database answers with source and retrieval time', other: null },
  { row: 'Nextflow, Snakemake and SLURM tools for agents', other: null },
  { row: 'Viewers for FASTA, VCF, GFF and 3D structures', other: null },
  { row: 'Offline mode for patient or unpublished data', other: null },
  { row: 'Projects as plain folders, git optional', other: 'Git repos' },
  { row: 'Any CLI agent, side by side', other: 'One or two' },
  { row: 'Open source under MIT', other: 'Rarely' }
]

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'What is Helix?',
    a: 'A desktop app where AI agents work on your research project. You chat with an agent; it searches the literature, queries biological databases, runs pipelines and opens the results next to the conversation, citing every source.'
  },
  {
    q: 'Do I need to know how to code?',
    a: 'No. Ask in plain language and the agent writes and runs the commands. Every command runs in a real terminal you can open, so bioinformaticians keep full control.'
  },
  {
    q: 'Which agents does it work with?',
    a: 'Claude Code, Codex, Gemini CLI, OpenCode, Goose, Aider and any other CLI agent. Helix is not a model; you bring the agent and subscription you already use.'
  },
  {
    q: 'Where does my data go?',
    a: (
      <>
        Helix is not a hosted service: files stay on your machine or servers you control. The agent
        you choose sends what it reads to its own provider, and sensitive data mode turns off every
        public-database call. Usage analytics are opt-in; see{' '}
        <Link href="/docs/telemetry" className="underline underline-offset-4">
          Privacy & Telemetry
        </Link>
        .
      </>
    )
  },
  {
    q: 'Can it use my cluster?',
    a: 'Yes. Add an SSH host and agents can read Nextflow traces, Snakemake progress and SLURM jobs there. Submitting or cancelling jobs is off unless you allow it, and agents ask first.'
  },
  {
    q: 'Which platforms are supported?',
    a: 'The closed beta ships for Windows and Linux. macOS builds follow once they are notarized; until then you can build from source.'
  },
  {
    q: 'How much does it cost?',
    a: 'Helix is free and open source under the MIT License. You only pay for the agent or model subscription you choose.'
  }
]

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1 pt-14">
        <section className="relative overflow-hidden">
          <GridField />
          <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-4 pt-20 text-center md:pt-28">
            <span className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 backdrop-blur">
              <span className="landing-live-dot size-1.5 rounded-full bg-brand" />
              <Readout items={['Closed beta', 'Windows & Linux', 'Open source']} />
            </span>
            <h1 className="max-w-4xl text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-6xl md:text-7xl">
              Run the analysis.
              <br />
              <span className="text-muted-foreground">Keep the evidence.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
              Chat with Claude Code, Codex or any CLI agent on your research project. It searches
              PubMed, queries UniProt and Ensembl, runs Nextflow on your cluster and opens the
              results, with every answer cited.
            </p>
            <div className="mt-10">
              <DownloadButton
                secondary={
                  <Link href="/docs" className={secondaryButton}>
                    Read the docs
                  </Link>
                }
              />
            </div>
          </div>
          <div className="relative mx-auto mt-16 max-w-[1200px] px-4 md:mt-20">
            <ProductMockup />
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Illustrative sessions. Every database answer keeps its source and retrieval time.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 pt-28 pb-20 md:pt-36">
          <SectionHeading
            title="Built for the bench, end to end."
            body="The tools a life-science project actually uses, wired into the agents you already trust."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/15"
              >
                <div className="flex h-40 items-center border-b border-border bg-background/40 px-5">
                  {feature.visual}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <h3 className="flex items-center justify-between gap-2 text-[15px] font-semibold">
                    {feature.title}
                    {feature.planned ? (
                      <span className="rounded-full border border-border px-2 py-0.5 font-mono text-3xs font-normal tracking-wider text-muted-foreground uppercase">
                        Planned
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-8 flex flex-col gap-2">
            <Readout items={['PubMed', 'NCBI', 'UniProt', 'PDB', 'AlphaFold DB', 'Ensembl']} />
            <Readout items={['Nextflow', 'Snakemake', 'SLURM over SSH', 'Jupyter', 'bioconda']} />
          </div>
        </section>

        <div className="mx-auto max-w-[1200px] px-4">
          <BasePairRule />
        </div>

        <section className="mx-auto max-w-[1200px] px-4 py-20 md:py-28">
          <SectionHeading title="One workspace for the whole lab." />
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {AUDIENCES.map((audience) => (
              <div key={audience.title} className="flex flex-col gap-3 border-t border-border pt-6">
                <h3 className="text-lg font-semibold tracking-tight">{audience.title}</h3>
                <p className="text-[15px] leading-relaxed text-muted-foreground">{audience.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-card">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-16 md:flex-row md:items-center md:justify-between">
            <div className="flex max-w-md flex-col gap-3">
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                Bring your own agent.
              </h2>
              <p className="text-[15px] text-muted-foreground">
                Helix is not a model. Keep the subscription you have and run agents side by side.
              </p>
            </div>
            <ul className="flex max-w-xl flex-wrap gap-2 md:justify-end">
              {AGENTS.map((agent) => (
                <li
                  key={agent}
                  className="rounded-lg border border-border bg-background px-3.5 py-1.5 text-sm"
                >
                  {agent}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-20 md:py-28">
          <SectionHeading
            title="Built for research, not retrofitted."
            body="General coding tools treat a genome like any other folder. Helix starts from the science."
          />
          <div className="mt-12 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border bg-card text-left text-muted-foreground">
                  <th className="px-5 py-3.5 font-medium">Capability</th>
                  <th className="w-28 px-5 py-3.5 text-center font-semibold text-foreground">
                    Helix
                  </th>
                  <th className="w-40 px-5 py-3.5 text-center font-medium">Coding IDEs</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(({ row, other }) => (
                  <tr key={row} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5">{row}</td>
                    <td className="px-5 py-3.5 text-center">
                      <Check className="inline size-4 text-brand" aria-label="Yes" />
                    </td>
                    <td className="px-5 py-3.5 text-center text-muted-foreground">
                      {other ?? <Minus className="inline size-4 opacity-50" aria-label="No" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 md:grid-cols-[1fr_1.4fr] md:py-28">
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-semibold tracking-[-0.03em] md:text-5xl">
                Frequently asked questions
              </h2>
              <Link
                href="/docs"
                className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                More in the docs <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            <div className="flex flex-col">
              {FAQ.map((item) => (
                <details key={item.q} className="group border-b border-border">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="pb-5 text-[15px] leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-border">
          <GridField />
          <div className="relative mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-4 py-24 text-center md:py-32">
            <HelixMark className="size-14 text-foreground" />
            <h2 className="text-4xl font-semibold tracking-[-0.04em] md:text-6xl">Get Helix</h2>
            <p className="max-w-md text-base text-muted-foreground md:text-lg">
              Free and open source. Start your first analysis in a few minutes.
            </p>
            <div className="mt-2">
              <DownloadButton
                secondary={
                  <a href={REPO_URL} className={secondaryButton}>
                    <GithubMark className="size-4" />
                    View on GitHub
                  </a>
                }
              />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
