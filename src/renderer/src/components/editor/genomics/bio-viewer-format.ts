import { genomicTableFormatForLanguage, type GenomicTableFormat } from './genomic-table-parse'

export type BioViewerFormat = GenomicTableFormat | 'fasta'

export function bioViewerFormatForLanguage(language: string): BioViewerFormat | null {
  return language === 'fasta' ? 'fasta' : genomicTableFormatForLanguage(language)
}
