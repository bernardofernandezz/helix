export type GenomicTableFormat = 'vcf' | 'bed' | 'gff'

export type GenomicFactKey =
  | 'format'
  | 'sequences'
  | 'reference'
  | 'samples'
  | 'gffVersion'
  | 'features'

export type GenomicFact = { key: GenomicFactKey; value: string }

export type GenomicTable = {
  format: GenomicTableFormat
  metaLines: string[]
  columns: string[]
  rows: string[][]
  totalRecords: number
  // Rows beyond the cap are counted but not kept, so huge files stay responsive.
  truncated: boolean
  facts: GenomicFact[]
}

export const GENOMIC_TABLE_MAX_ROWS = 100_000

const VCF_FIXED_COLUMNS = ['CHROM', 'POS', 'ID', 'REF', 'ALT', 'QUAL', 'FILTER', 'INFO']
const GFF_COLUMNS = [
  'seqid',
  'source',
  'type',
  'start',
  'end',
  'score',
  'strand',
  'phase',
  'attributes'
]
const BED_COLUMNS = [
  'chrom',
  'chromStart',
  'chromEnd',
  'name',
  'score',
  'strand',
  'thickStart',
  'thickEnd',
  'itemRgb',
  'blockCount',
  'blockSizes',
  'blockStarts'
]

const GENOMIC_LANGUAGE_FORMATS: Record<string, GenomicTableFormat> = {
  vcf: 'vcf',
  bed: 'bed',
  gff: 'gff'
}

export function genomicTableFormatForLanguage(language: string): GenomicTableFormat | null {
  return GENOMIC_LANGUAGE_FORMATS[language] ?? null
}

function isMetaLine(format: GenomicTableFormat, line: string): boolean {
  if (line.startsWith('#')) {
    return true
  }
  return format === 'bed' && (line.startsWith('track') || line.startsWith('browser'))
}

function metaValue(metaLines: string[], key: string): string | null {
  const prefix = `##${key}`
  const line = metaLines.find((candidate) => candidate.startsWith(prefix))
  return line
    ? line
        .slice(prefix.length)
        .replace(/^[=\s]+/, '')
        .trim()
    : null
}

function columnsFor(format: GenomicTableFormat, metaLines: string[], width: number): string[] {
  if (format === 'vcf') {
    const header = metaLines.findLast((line) => line.startsWith('#CHROM'))
    if (header) {
      return header.slice(1).split('\t')
    }
    return VCF_FIXED_COLUMNS
  }
  if (format === 'gff') {
    return GFF_COLUMNS
  }
  // BED has no header, but tools often write "#chrom\tstart\tend…" as the last comment line.
  const lastComment = metaLines.at(-1)
  if (lastComment?.startsWith('#') && lastComment.includes('\t')) {
    return lastComment.replace(/^#+/, '').split('\t')
  }
  return Array.from({ length: width }, (_, index) => BED_COLUMNS[index] ?? `column ${index + 1}`)
}

export function parseGenomicTable(
  format: GenomicTableFormat,
  content: string,
  maxRows = GENOMIC_TABLE_MAX_ROWS
): GenomicTable {
  const metaLines: string[] = []
  const rows: string[][] = []
  const sequences = new Set<string>()
  const featureTypes = new Map<string, number>()
  let totalRecords = 0
  let width = 0

  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.trim() === '') {
      continue
    }
    if (totalRecords === 0 && isMetaLine(format, line)) {
      metaLines.push(line)
      continue
    }
    // An embedded FASTA section ends the GFF3 feature table.
    if (format === 'gff' && line.startsWith('##FASTA')) {
      break
    }
    if (line.startsWith('#')) {
      continue
    }
    totalRecords += 1
    const fields = line.split('\t')
    sequences.add(fields[0] ?? '')
    if (format === 'gff' && fields[2]) {
      featureTypes.set(fields[2], (featureTypes.get(fields[2]) ?? 0) + 1)
    }
    if (rows.length < maxRows) {
      rows.push(fields)
      width = Math.max(width, fields.length)
    }
  }

  const columns = columnsFor(format, metaLines, width)
  return {
    format,
    metaLines,
    columns,
    rows,
    totalRecords,
    truncated: totalRecords > rows.length,
    facts: factsFor(format, metaLines, columns, sequences.size, featureTypes)
  }
}

function factsFor(
  format: GenomicTableFormat,
  metaLines: string[],
  columns: string[],
  sequenceCount: number,
  featureTypes: Map<string, number>
): GenomicFact[] {
  const facts: GenomicFact[] = [{ key: 'sequences', value: String(sequenceCount) }]
  if (format === 'vcf') {
    const fileformat = metaValue(metaLines, 'fileformat')
    const reference = metaValue(metaLines, 'reference')
    const formatIndex = columns.indexOf('FORMAT')
    if (fileformat) {
      facts.unshift({ key: 'format', value: fileformat })
    }
    if (reference) {
      facts.push({ key: 'reference', value: reference })
    }
    facts.push({
      key: 'samples',
      value: String(formatIndex === -1 ? 0 : columns.length - formatIndex - 1)
    })
  }
  if (format === 'gff') {
    const version = metaValue(metaLines, 'gff-version')
    if (version) {
      facts.unshift({ key: 'gffVersion', value: version })
    }
    const topTypes = [...featureTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([type, count]) => `${type} ${count}`)
    if (topTypes.length > 0) {
      facts.push({ key: 'features', value: topTypes.join(', ') })
    }
  }
  return facts
}
