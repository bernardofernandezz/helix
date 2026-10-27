export type SequenceAlphabet = 'dna' | 'rna' | 'protein'

export type FastaRecord = {
  id: string
  description: string
  sequence: string
  length: number
  // Share of G+C among A/C/G/T/U residues; null for proteins.
  gcPercent: number | null
}

export type FastaDocument = {
  records: FastaRecord[]
  totalRecords: number
  totalLength: number
  alphabet: SequenceAlphabet
  truncated: boolean
}

export const FASTA_MAX_RECORDS = 20_000

const NUCLEOTIDE_RESIDUES = /^[ACGTUNRYKMSWBDHV.*-]*$/i
const ALPHABET_SAMPLE = 20_000

export function detectAlphabet(sample: string): SequenceAlphabet {
  if (!NUCLEOTIDE_RESIDUES.test(sample)) {
    return 'protein'
  }
  const upper = sample.toUpperCase()
  return upper.includes('U') && !upper.includes('T') ? 'rna' : 'dna'
}

function gcPercent(sequence: string): number | null {
  let gc = 0
  let counted = 0
  for (const residue of sequence.toUpperCase()) {
    if (residue === 'G' || residue === 'C') {
      gc += 1
      counted += 1
    } else if (residue === 'A' || residue === 'T' || residue === 'U') {
      counted += 1
    }
  }
  return counted === 0 ? null : (gc / counted) * 100
}

export function parseFasta(content: string, maxRecords = FASTA_MAX_RECORDS): FastaDocument {
  const records: FastaRecord[] = []
  let totalRecords = 0
  let totalLength = 0
  let header: string | null = null
  let chunks: string[] = []
  let sample = ''

  const finish = (): void => {
    if (header === null) {
      return
    }
    const sequence = chunks.join('')
    totalRecords += 1
    totalLength += sequence.length
    if (sample.length < ALPHABET_SAMPLE) {
      sample += sequence.slice(0, ALPHABET_SAMPLE - sample.length)
    }
    if (records.length < maxRecords) {
      const space = header.search(/\s/)
      records.push({
        id: space === -1 ? header : header.slice(0, space),
        description: space === -1 ? '' : header.slice(space + 1).trim(),
        sequence,
        length: sequence.length,
        gcPercent: null
      })
    }
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('>')) {
      finish()
      header = line.slice(1).trim()
      chunks = []
    } else if (line !== '' && !line.startsWith(';') && header !== null) {
      chunks.push(line.replace(/\s+/g, ''))
    }
  }
  finish()

  const alphabet = detectAlphabet(sample)
  if (alphabet !== 'protein') {
    for (const record of records) {
      record.gcPercent = gcPercent(record.sequence)
    }
  }
  return { records, totalRecords, totalLength, alphabet, truncated: totalRecords > records.length }
}

/** Splits a sequence into display lines of `width` residues, each with its 1-based start. */
export function wrapSequence(
  sequence: string,
  width: number,
  maxResidues: number
): { start: number; text: string }[] {
  const shown = sequence.slice(0, maxResidues)
  const lines: { start: number; text: string }[] = []
  for (let offset = 0; offset < shown.length; offset += width) {
    lines.push({ start: offset + 1, text: shown.slice(offset, offset + width) })
  }
  return lines
}
