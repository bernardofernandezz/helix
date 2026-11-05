import { cn } from '@/lib/class-names'

const PAPERS = [
  {
    title: 'Zinc loss and misfolding of the p53 R175H DNA-binding domain',
    venue: '2023 · research article'
  },
  {
    title: 'Restoring zinc binding rescues mutant p53 conformation',
    venue: '2022 · research article'
  },
  { title: 'Thermal stability across hotspot TP53 variants', venue: '2024 · research article' },
  { title: 'A cryo-EM view of mutant p53 tetramers on DNA', venue: '2025 · review' }
]

export function PaperList() {
  return (
    <ol className="divide-y divide-border">
      {PAPERS.map((paper, i) => (
        <li key={paper.title} className="flex gap-3 px-4 py-3">
          <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] leading-snug">{paper.title}</span>
            <span className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">
              {paper.venue} · PMID · DOI
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}

const VARIANTS = [
  { id: 'p.Arg403Gln', gene: 'MYH7', effect: 'missense', sift: 0, polyphen: 0.99 },
  { id: 'p.Arg502Trp', gene: 'MYBPC3', effect: 'missense', sift: 0.01, polyphen: 0.97 },
  { id: 'p.Asp376=', gene: 'MYH7', effect: 'synonymous', sift: null, polyphen: null },
  { id: 'p.Arg92Gln', gene: 'TNNT2', effect: 'missense', sift: 0.02, polyphen: 0.91 },
  { id: 'p.Gly382Ser', gene: 'LMNA', effect: 'missense', sift: 0.34, polyphen: 0.12 },
  { id: 'c.10303+12A>G', gene: 'TTN', effect: 'intron', sift: null, polyphen: null }
]

export function VariantTable() {
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr className="border-b border-border text-left text-2xs tracking-wider text-muted-foreground uppercase">
          <th className="px-4 py-2 font-medium">Variant</th>
          <th className="px-2 py-2 font-medium">Gene</th>
          <th className="px-2 py-2 font-medium">Effect</th>
          <th className="px-2 py-2 text-right font-medium">SIFT</th>
          <th className="px-4 py-2 text-right font-medium">PolyPhen</th>
        </tr>
      </thead>
      <tbody>
        {VARIANTS.map((v) => {
          const flagged = v.sift !== null && v.sift < 0.05
          return (
            <tr key={v.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2 text-muted-foreground">{v.id}</td>
              <td className="px-2 py-2 italic">{v.gene}</td>
              <td className="px-2 py-2 text-muted-foreground">{v.effect}</td>
              <td className={cn('px-2 py-2 text-right', flagged && 'text-annotation-highlight')}>
                {v.sift ?? '·'}
              </td>
              <td className={cn('px-4 py-2 text-right', flagged && 'text-annotation-highlight')}>
                {v.polyphen ?? '·'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const PROCESSES = [
  { name: 'FASTQC', done: 24, total: 24 },
  { name: 'TRIMGALORE', done: 24, total: 24 },
  { name: 'STAR_ALIGN', done: 17, total: 24 },
  { name: 'SALMON_QUANT', done: 9, total: 24 },
  { name: 'MULTIQC', done: 0, total: 1 }
]

export function PipelineTerminal() {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 font-mono text-xs">
      <p>
        <span className="text-brand">hpc</span>{' '}
        <span className="text-muted-foreground">~/liver-rnaseq $</span> nextflow run nf-core/rnaseq
        -profile slurm
      </p>
      <p className="text-muted-foreground">executor › slurm (48)</p>
      <ul className="flex flex-col gap-2">
        {PROCESSES.map((p) => (
          <li key={p.name} className="grid grid-cols-[110px_1fr_44px] items-center gap-3">
            <span className="truncate">{p.name}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-accent">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${(p.done / p.total) * 100}%` }}
              />
            </span>
            <span className="text-right text-muted-foreground tabular-nums">
              {p.done}/{p.total}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">sacct 4815162 · RUNNING · 01:42:10 · peak 31.2 GB</p>
    </div>
  )
}

// Prolate cycloid reads as a cartoon α-helix; a pure function keeps SSR and client identical.
function helixPath(x0: number, y0: number, turns: number, dir: 1 | -1): string {
  const points: string[] = []
  for (let t = 0; t <= turns * Math.PI * 2; t += 0.25) {
    const x = x0 + dir * (7 * t - 14 * Math.sin(t))
    const y = y0 - 14 * Math.cos(t)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return `M${points.join(' L')}`
}

// AlphaFold's pLDDT bands: very high, confident, low, very low.
const PLDDT = ['#0053d6', '#65cbf3', '#ffdb13', '#ff7d45']

export function StructureView() {
  return (
    <div className="flex h-full flex-col">
      <svg viewBox="0 0 320 220" className="w-full flex-1" aria-hidden="true">
        <path d="M18 196 C40 170 30 140 58 132" stroke={PLDDT[3]} strokeWidth="3" fill="none" />
        <path d="M58 132 C70 128 72 120 74 112" stroke={PLDDT[1]} strokeWidth="3" fill="none" />
        <path
          d={helixPath(74, 100, 4, 1)}
          stroke={PLDDT[0]}
          strokeWidth="4"
          fill="none"
          strokeLinejoin="round"
        />
        <path d="M250 100 C290 104 296 140 262 150" stroke={PLDDT[1]} strokeWidth="3" fill="none" />
        <path
          d="M262 150 L120 166 L120 158 L104 170 L120 182 L120 174 L262 160 Z"
          fill={PLDDT[0]}
        />
        <path d="M100 176 C70 190 80 206 120 200" stroke={PLDDT[2]} strokeWidth="3" fill="none" />
        <path
          d="M120 194 L240 190 L240 184 L256 196 L240 208 L240 202 L120 204 Z"
          fill={PLDDT[0]}
        />
        <path d="M256 196 C290 200 300 60 270 46" stroke={PLDDT[2]} strokeWidth="3" fill="none" />
        <path
          d={helixPath(270, 40, 3, -1)}
          stroke={PLDDT[1]}
          strokeWidth="4"
          fill="none"
          strokeLinejoin="round"
        />
        <path d="M138 40 C110 36 96 52 70 44" stroke={PLDDT[3]} strokeWidth="3" fill="none" />
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <span className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">
          pLDDT 87.4 · RES 2.2 Å · AF-P00533-F1
        </span>
        <span className="flex gap-1" aria-hidden="true">
          {PLDDT.map((color) => (
            <span key={color} className="h-1.5 w-4 rounded-full" style={{ background: color }} />
          ))}
        </span>
      </div>
    </div>
  )
}
