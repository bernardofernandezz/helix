'use client'

import { ArrowUp, BookOpenText, Box, Dna, FileText, Workflow } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/class-names'
import { PaperList, PipelineTerminal, StructureView, VariantTable } from './MockupViewers'

type ToolCall = { tool: string; args: string; result: string; source: string }

type Scene = {
  id: string
  label: string
  icon: ReactNode
  project: string
  prompt: string
  calls: ToolCall[]
  answer: ReactNode
  file: string
  viewer: ReactNode
}

const PROJECTS = [
  { name: 'tp53-r175h', meta: 'literature review' },
  { name: 'cardio-panel', meta: 'variant annotation' },
  { name: 'liver-rnaseq', meta: 'nf-core/rnaseq · hpc' },
  { name: 'kinase-fold', meta: 'structure comparison' }
]

function Cite({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 rounded-sm bg-accent px-1 font-mono text-[10px] text-muted-foreground">
      {n}
    </sup>
  )
}

const SCENES: Scene[] = [
  {
    id: 'literature',
    label: 'Ask the literature',
    icon: <BookOpenText className="size-3.5" />,
    project: 'tp53-r175h',
    prompt: 'How does R175H change TP53 structure? Cite papers from the last five years.',
    calls: [
      {
        tool: 'pubmed_search',
        args: '"TP53 R175H" structure 2021:2026',
        result: '23 papers',
        source: 'PubMed · 14:56'
      },
      {
        tool: 'pubmed_fetch_abstracts',
        args: 'top 4 by relevance',
        result: '4 abstracts',
        source: 'PubMed · 14:56'
      }
    ],
    answer: (
      <>
        R175H loosens zinc binding in the DNA-binding domain, leaving it partly unfolded at body
        temperature
        <Cite n={1} />
        <Cite n={3} />. Compounds that restore zinc partially rescue folding
        <Cite n={2} />.
      </>
    ),
    file: 'notes/papers.md',
    viewer: <PaperList />
  },
  {
    id: 'variants',
    label: 'Annotate variants',
    icon: <Dna className="size-3.5" />,
    project: 'cardio-panel',
    prompt: 'Annotate the variants in panel.vcf and flag anything predicted damaging.',
    calls: [
      {
        tool: 'ensembl_variant_effect',
        args: 'data/panel.vcf · 214 variants',
        result: 'consequence, SIFT, PolyPhen',
        source: 'Ensembl VEP · release 113'
      }
    ],
    answer: (
      <>
        12 missense variants; 3 are deleterious by both SIFT and PolyPhen. I added a{' '}
        <code className="rounded bg-accent px-1 font-mono text-xs">flag</code> column to{' '}
        <code className="rounded bg-accent px-1 font-mono text-xs">results/panel.tsv</code>.
      </>
    ),
    file: 'results/panel.tsv',
    viewer: <VariantTable />
  },
  {
    id: 'pipelines',
    label: 'Run pipelines',
    icon: <Workflow className="size-3.5" />,
    project: 'liver-rnaseq',
    prompt: 'Run nf-core/rnaseq on the cluster and tell me if anything fails.',
    calls: [
      {
        tool: 'nextflow_runs',
        args: 'host hpc',
        result: 'run elegant_curie · 61% complete',
        source: 'Nextflow trace over SSH'
      },
      {
        tool: 'slurm_job',
        args: 'hpc · 4815162',
        result: 'RUNNING, peak 31.2 GB',
        source: 'sacct over SSH'
      }
    ],
    answer: (
      <>
        The run is healthy: alignment is at 17 of 24 samples and nothing has been retried. I will
        check again when quantification finishes.
      </>
    ),
    file: 'Terminal · hpc',
    viewer: <PipelineTerminal />
  },
  {
    id: 'structures',
    label: 'Inspect structures',
    icon: <Box className="size-3.5" />,
    project: 'kinase-fold',
    prompt: 'Compare the AlphaFold model of EGFR with the best experimental structure.',
    calls: [
      {
        tool: 'uniprot_entry',
        args: 'P00533',
        result: 'function, 300+ PDB entries',
        source: 'UniProtKB · 2026_04'
      },
      {
        tool: 'alphafold_prediction',
        args: 'P00533',
        result: 'model v4, mean pLDDT 87.4',
        source: 'AlphaFold DB'
      }
    ],
    answer: (
      <>
        The kinase domain agrees with the 2.2 Å crystal structure to within 0.8 Å RMSD.
        Low-confidence regions are the disordered C-terminal tail, colored orange.
      </>
    ),
    file: 'structures/AF-P00533.pdb',
    viewer: <StructureView />
  }
]

function ChatPane({ scene }: { scene: Scene }) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-4 p-4 text-[13px] sm:p-5">
      <div className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3.5 py-2.5 leading-relaxed">
        {scene.prompt}
      </div>
      <ol className="flex flex-col gap-2">
        {scene.calls.map((call) => (
          <li
            key={call.tool}
            className="rounded-lg border border-border bg-background/60 px-3 py-2"
          >
            <code className="block truncate font-mono text-xs">
              <span className="text-brand">{call.tool}</span>{' '}
              <span className="text-muted-foreground">{call.args}</span>
            </code>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-xs">→ {call.result}</span>
              <span className="font-mono text-3xs tracking-wider text-muted-foreground uppercase">
                {call.source}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <p className="leading-relaxed text-foreground/90">{scene.answer}</p>
      <div className="mt-auto flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-muted-foreground">
        <span className="flex-1 truncate">Ask a follow-up…</span>
        <span className="hidden font-mono text-3xs tracking-wider uppercase sm:inline">
          Opus · helix-research
        </span>
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ArrowUp className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </div>
  )
}

export function ProductMockup() {
  const [activeId, setActiveId] = useState(SCENES[0].id)
  const scene = SCENES.find((s) => s.id === activeId) ?? SCENES[0]

  return (
    <div className="flex flex-col items-center gap-6">
      <div
        role="tablist"
        aria-label="Example sessions"
        className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1"
      >
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`scene-tab-${s.id}`}
            aria-selected={s.id === activeId}
            aria-controls="scene-panel"
            onClick={() => setActiveId(s.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              s.id === activeId
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      <figure
        id="scene-panel"
        role="tabpanel"
        aria-labelledby={`scene-tab-${scene.id}`}
        className="w-full overflow-hidden rounded-2xl border border-border bg-card text-left shadow-[0_30px_80px_-20px_rgb(0_0_0/0.45)]"
      >
        <div className="flex h-10 items-center gap-3 border-b border-border px-4">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">Helix</span>
          <span className="ml-auto font-mono text-2xs tracking-wider text-muted-foreground uppercase">
            Claude Code · helix-research
          </span>
        </div>

        <div className="grid h-[460px] md:grid-cols-[200px_1fr] lg:grid-cols-[200px_1fr_1.1fr]">
          <aside className="hidden flex-col gap-1 border-r border-border p-3 md:flex">
            <span className="px-2 pb-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
              Projects
            </span>
            {PROJECTS.map((project) => {
              const active = project.name === scene.project
              return (
                <div
                  key={project.name}
                  className={cn('flex flex-col rounded-md px-2 py-1.5', active && 'bg-accent')}
                >
                  <span className="flex items-center gap-2 text-[13px]">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        active ? 'landing-live-dot bg-brand' : 'bg-muted-foreground/40'
                      )}
                    />
                    {project.name}
                  </span>
                  <span className="pl-3.5 font-mono text-3xs text-muted-foreground">
                    {project.meta}
                  </span>
                </div>
              )
            })}
          </aside>

          <div className="overflow-hidden">
            <ChatPane scene={scene} />
          </div>

          <div className="hidden min-w-0 flex-col overflow-hidden border-l border-border lg:flex">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-xs text-muted-foreground">
              <FileText className="size-3.5" aria-hidden="true" />
              <span className="truncate font-mono">{scene.file}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{scene.viewer}</div>
          </div>
        </div>
        <figcaption className="sr-only">
          Illustrative Helix session: {scene.label.toLowerCase()}.
        </figcaption>
      </figure>
    </div>
  )
}
