import { describe, expect, it } from 'vitest'
import { detectAlphabet, parseFasta, wrapSequence } from './fasta-parse'
import { parseGenomicTable } from './genomic-table-parse'

const VCF = [
  '##fileformat=VCFv4.2',
  '##reference=GRCh38',
  '##contig=<ID=chr1>',
  '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\tS2',
  'chr1\t100\trs1\tA\tG\t50\tPASS\tDP=10\tGT\t0/1\t1/1',
  'chr2\t200\t.\tC\tT\t.\tq10\tDP=3\tGT\t0/0\t0/1',
  ''
].join('\r\n')

describe('parseGenomicTable', () => {
  it('keeps VCF meta lines apart and reads samples from the header', () => {
    const table = parseGenomicTable('vcf', VCF)
    expect(table.metaLines).toHaveLength(4)
    expect(table.columns).toEqual([
      'CHROM',
      'POS',
      'ID',
      'REF',
      'ALT',
      'QUAL',
      'FILTER',
      'INFO',
      'FORMAT',
      'S1',
      'S2'
    ])
    expect(table.rows[1]).toEqual([
      'chr2',
      '200',
      '.',
      'C',
      'T',
      '.',
      'q10',
      'DP=3',
      'GT',
      '0/0',
      '0/1'
    ])
    expect(table.facts).toEqual([
      { key: 'format', value: 'VCFv4.2' },
      { key: 'sequences', value: '2' },
      { key: 'reference', value: 'GRCh38' },
      { key: 'samples', value: '2' }
    ])
  })

  it('stops GFF3 at an embedded FASTA section and counts feature types', () => {
    const gff = [
      '##gff-version 3',
      'ctg1\tsrc\tgene\t1\t900\t.\t+\t.\tID=g1',
      'ctg1\tsrc\tmRNA\t1\t900\t.\t+\t.\tID=m1;Parent=g1',
      '# a comment between features',
      'ctg1\tsrc\texon\t1\t300\t.\t+\t.\tParent=m1',
      '##FASTA',
      '>ctg1',
      'ACGT'
    ].join('\n')
    const table = parseGenomicTable('gff', gff)
    expect(table.totalRecords).toBe(3)
    expect(table.columns.at(-1)).toBe('attributes')
    expect(table.facts).toContainEqual({ key: 'gffVersion', value: '3' })
    expect(table.facts).toContainEqual({ key: 'features', value: 'gene 1, mRNA 1, exon 1' })
  })

  it('names BED columns from a commented header or the BED spec', () => {
    const withHeader = parseGenomicTable('bed', '#chrom\tstart\tend\tpeak\nchr1\t1\t5\tp1\n')
    expect(withHeader.columns).toEqual(['chrom', 'start', 'end', 'peak'])
    const plain = parseGenomicTable('bed', 'track name=x\nchr1\t1\t5\tp1\t0\t+\n')
    expect(plain.metaLines).toEqual(['track name=x'])
    expect(plain.columns).toEqual(['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand'])
  })

  it('counts every record but keeps only the row cap', () => {
    const body = Array.from({ length: 10 }, (_, i) => `chr1\t${i}\t${i + 1}`).join('\n')
    const table = parseGenomicTable('bed', body, 4)
    expect(table.rows).toHaveLength(4)
    expect(table.totalRecords).toBe(10)
    expect(table.truncated).toBe(true)
  })
})

describe('parseFasta', () => {
  it('reads multi-line records with ids, descriptions and GC content', () => {
    const doc = parseFasta('>seq1 first gene\nACGT\nGGCC\n\n>seq2\nAATT\n')
    expect(doc.alphabet).toBe('dna')
    expect(doc.totalLength).toBe(12)
    expect(doc.records.map((r) => [r.id, r.description, r.length])).toEqual([
      ['seq1', 'first gene', 8],
      ['seq2', '', 4]
    ])
    expect(doc.records[0]?.gcPercent).toBeCloseTo(75)
    expect(doc.records[1]?.gcPercent).toBe(0)
  })

  it('detects proteins and RNA', () => {
    expect(detectAlphabet('MEEPQSDPSVEPPLSQETF')).toBe('protein')
    expect(detectAlphabet('ACGUUAGC')).toBe('rna')
    const protein = parseFasta('>sp|P04637|P53_HUMAN Cellular tumor antigen p53\nMEEPQSDPSV\n')
    expect(protein.alphabet).toBe('protein')
    expect(protein.records[0]?.gcPercent).toBeNull()
  })

  it('caps kept records while counting all of them', () => {
    const doc = parseFasta('>a\nAC\n>b\nGT\n>c\nAA\n', 2)
    expect(doc.records).toHaveLength(2)
    expect(doc.totalRecords).toBe(3)
    expect(doc.truncated).toBe(true)
  })

  it('wraps sequences with 1-based starts', () => {
    expect(wrapSequence('ACGTACGTAC', 4, 9)).toEqual([
      { start: 1, text: 'ACGT' },
      { start: 5, text: 'ACGT' },
      { start: 9, text: 'A' }
    ])
  })
})
