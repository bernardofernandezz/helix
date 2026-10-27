import React, { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import {
  parseGenomicTable,
  type GenomicFactKey,
  type GenomicTableFormat
} from './genomic-table-parse'

const ROW_HEIGHT = 26
const ROW_NUMBER_WIDTH = '7ch'
const WIDTH_SAMPLE_ROWS = 200
const MAX_META_LINES_SHOWN = 1_000

const FORMAT_NAMES: Record<GenomicTableFormat, string> = { vcf: 'VCF', bed: 'BED', gff: 'GFF' }

function factLabel(key: GenomicFactKey): string {
  switch (key) {
    case 'format':
      return translate('helix.genomicViewer.fact.format', 'Format')
    case 'sequences':
      return translate('helix.genomicViewer.fact.sequences', 'Sequences')
    case 'reference':
      return translate('helix.genomicViewer.fact.reference', 'Reference')
    case 'samples':
      return translate('helix.genomicViewer.fact.samples', 'Samples')
    case 'gffVersion':
      return translate('helix.genomicViewer.fact.gffVersion', 'GFF version')
    case 'features':
      return translate('helix.genomicViewer.fact.features', 'Features')
  }
}

function columnWidths(columns: string[], rows: string[][]): string[] {
  return columns.map((name, index) => {
    let chars = name.length
    for (const row of rows.slice(0, WIDTH_SAMPLE_ROWS)) {
      chars = Math.max(chars, row[index]?.length ?? 0)
    }
    return `calc(${Math.min(Math.max(chars, 4), 40) + 2}ch + 16px)`
  })
}

type GenomicTableViewerProps = {
  content: string
  format: GenomicTableFormat
}

/** Read-only table view; edits happen in Source mode so header and meta lines are never rewritten. */
export default function GenomicTableViewer({
  content,
  format
}: GenomicTableViewerProps): React.JSX.Element {
  const table = useMemo(() => parseGenomicTable(format, content), [format, content])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const rows = useMemo(
    () =>
      deferredQuery === ''
        ? table.rows
        : table.rows.filter((row) => row.join('\t').toLowerCase().includes(deferredQuery)),
    [table.rows, deferredQuery]
  )
  const widths = useMemo(() => columnWidths(table.columns, table.rows), [table])
  const gridTemplateColumns = `${ROW_NUMBER_WIDTH} ${widths.join(' ')}`
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
        <span className="font-mono text-2xs font-semibold tracking-wider uppercase">
          {FORMAT_NAMES[format]}
        </span>
        {table.facts.map((fact) => (
          <span key={fact.key} className="font-mono text-2xs tracking-wider text-muted-foreground">
            <span className="uppercase">{factLabel(fact.key)}</span>{' '}
            <span className="text-foreground">{fact.value}</span>
          </span>
        ))}
        <span className="font-mono text-2xs tracking-wider text-muted-foreground">
          {translate('helix.genomicViewer.records', '{{shown}} of {{total}} records', {
            shown: rows.length.toLocaleString(),
            total: table.totalRecords.toLocaleString()
          })}
        </span>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate('helix.genomicViewer.filter', 'Filter records')}
          aria-label={translate('helix.genomicViewer.filter', 'Filter records')}
          className="ml-auto h-7 w-56"
        />
      </div>

      {table.truncated ? (
        <p className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          {translate(
            'helix.genomicViewer.truncated',
            'Showing the first {{value}} records. Switch to Source to see the whole file.',
            { value: table.rows.length.toLocaleString() }
          )}
        </p>
      ) : null}

      {table.metaLines.length > 0 ? (
        <div className="border-b border-border px-3">
          <Collapsible>
            <CollapsibleTrigger variant="row">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                {translate('helix.genomicViewer.headerLines', 'Header lines ({{value}})', {
                  value: table.metaLines.length.toLocaleString()
                })}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="scrollbar-sleek max-h-56 overflow-auto pb-2 font-mono text-2xs text-muted-foreground">
                {table.metaLines.slice(0, MAX_META_LINES_SHOWN).join('\n')}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="scrollbar-editor min-h-0 flex-1 overflow-auto font-mono text-xs"
        role="table"
        aria-rowcount={rows.length + 1}
      >
        <div
          role="row"
          className="sticky top-0 z-10 grid w-max min-w-full border-b border-border bg-card font-semibold"
          style={{ gridTemplateColumns }}
        >
          <span role="columnheader" className="px-2 py-1 text-right text-muted-foreground">
            #
          </span>
          {table.columns.map((column, index) => (
            <span key={`${column}-${index}`} role="columnheader" className="truncate px-2 py-1">
              {column}
            </span>
          ))}
        </div>
        <div className="relative w-max min-w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index] ?? []
            return (
              <div
                key={item.key}
                role="row"
                className="absolute left-0 grid w-max min-w-full items-center border-b border-border/60 hover:bg-accent"
                style={{ gridTemplateColumns, height: ROW_HEIGHT, top: item.start }}
              >
                <span role="cell" className="px-2 text-right text-muted-foreground">
                  {item.index + 1}
                </span>
                {table.columns.map((column, index) => (
                  <span
                    key={`${column}-${index}`}
                    role="cell"
                    className="truncate px-2"
                    title={row[index]}
                  >
                    {row[index] ?? ''}
                  </span>
                ))}
              </div>
            )
          })}
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center font-sans text-sm text-muted-foreground">
            {translate('helix.genomicViewer.noMatches', 'No records match the filter.')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
