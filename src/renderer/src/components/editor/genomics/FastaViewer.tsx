import React, { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { parseFasta, wrapSequence, type SequenceAlphabet } from './fasta-parse'

const RECORD_ROW_HEIGHT = 44
const RESIDUES_PER_LINE = 60
const MAX_RESIDUES_SHOWN = 120_000

function alphabetLabel(alphabet: SequenceAlphabet): string {
  switch (alphabet) {
    case 'dna':
      return translate('helix.fastaViewer.alphabet.dna', 'DNA')
    case 'rna':
      return translate('helix.fastaViewer.alphabet.rna', 'RNA')
    case 'protein':
      return translate('helix.fastaViewer.alphabet.protein', 'Protein')
  }
}

const SEPARATOR = ' · '

function gcLabel(gcPercent: number): string {
  return translate('helix.fastaViewer.gc', 'GC {{value}}%', { value: gcPercent.toFixed(1) })
}

function recordSummary(
  record: { length: number; gcPercent: number | null; description?: string },
  unit: string
): string {
  return [
    `${record.length.toLocaleString()} ${unit}`,
    record.gcPercent === null ? null : gcLabel(record.gcPercent),
    record.description || null
  ]
    .filter((part) => part !== null)
    .join(SEPARATOR)
}

function lengthUnit(alphabet: SequenceAlphabet): string {
  return alphabet === 'protein'
    ? translate('helix.fastaViewer.unit.aa', 'aa')
    : translate('helix.fastaViewer.unit.bp', 'bp')
}

/** Read-only FASTA view; Source mode keeps the raw text editable. */
export default function FastaViewer({ content }: { content: string }): React.JSX.Element {
  const doc = useMemo(() => parseFasta(content), [content])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const [selectedIndex, setSelectedIndex] = useState(0)
  const visible = useMemo(
    () =>
      doc.records
        .map((record, index) => ({ record, index }))
        .filter(
          ({ record }) =>
            deferredQuery === '' ||
            record.id.toLowerCase().includes(deferredQuery) ||
            record.description.toLowerCase().includes(deferredQuery)
        ),
    [doc.records, deferredQuery]
  )
  const selected = doc.records[selectedIndex] ?? doc.records[0]
  const lines = useMemo(
    () => (selected ? wrapSequence(selected.sequence, RESIDUES_PER_LINE, MAX_RESIDUES_SHOWN) : []),
    [selected]
  )
  const listRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => RECORD_ROW_HEIGHT,
    overscan: 12
  })
  const unit = lengthUnit(doc.alphabet)
  const startWidth = String(selected?.length ?? 1).length

  if (doc.totalRecords === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-editor-surface text-sm text-muted-foreground">
        {translate(
          'helix.fastaViewer.empty',
          'No FASTA records found. Switch to Source to edit the file.'
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2 font-mono text-2xs tracking-wider">
        <span className="font-semibold uppercase">
          {['FASTA', alphabetLabel(doc.alphabet)].join(SEPARATOR)}
        </span>
        <span className="text-muted-foreground">
          {translate('helix.fastaViewer.records', '{{value}} records', {
            value: doc.totalRecords.toLocaleString()
          })}
        </span>
        <span className="text-muted-foreground">
          {doc.totalLength.toLocaleString()} {unit}
        </span>
        {doc.truncated ? (
          <span className="text-muted-foreground">
            {translate('helix.fastaViewer.truncated', 'listing the first {{value}}', {
              value: doc.records.length.toLocaleString()
            })}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate('helix.fastaViewer.filter', 'Filter by ID or description')}
              aria-label={translate('helix.fastaViewer.filter', 'Filter by ID or description')}
              className="h-7"
            />
          </div>
          <div
            ref={listRef}
            className="scrollbar-sleek min-h-0 flex-1 overflow-auto"
            role="listbox"
          >
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const entry = visible[item.index]
                if (!entry) {
                  return null
                }
                const isSelected = entry.record === selected
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-current={isSelected ? 'true' : undefined}
                    onClick={() => setSelectedIndex(entry.index)}
                    className={cn(
                      'absolute left-0 flex w-full flex-col justify-center px-3 text-left hover:bg-accent',
                      isSelected && 'bg-accent'
                    )}
                    style={{ top: item.start, height: RECORD_ROW_HEIGHT }}
                  >
                    <span className="truncate font-mono text-xs">{entry.record.id}</span>
                    <span className="truncate text-2xs text-muted-foreground">
                      {recordSummary(entry.record, unit)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {selected ? (
          <div className="scrollbar-editor min-h-0 flex-1 overflow-auto px-4 py-3">
            <h2 className="font-mono text-sm font-semibold">{selected.id}</h2>
            {selected.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{selected.description}</p>
            ) : null}
            <p className="mt-2 font-mono text-2xs tracking-wider text-muted-foreground uppercase">
              {recordSummary({ length: selected.length, gcPercent: selected.gcPercent }, unit)}
            </p>
            <pre className="mt-3 font-mono text-xs leading-5 select-text">
              {lines.map((line) => (
                <div key={line.start}>
                  <span
                    className="mr-3 inline-block text-right text-muted-foreground select-none"
                    style={{ width: `${startWidth}ch` }}
                  >
                    {line.start}
                  </span>
                  {line.text}
                </div>
              ))}
            </pre>
            {selected.length > MAX_RESIDUES_SHOWN ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {translate(
                  'helix.fastaViewer.sequenceTruncated',
                  'Showing the first {{value}} residues. Switch to Source to see the whole sequence.',
                  { value: MAX_RESIDUES_SHOWN.toLocaleString() }
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
