import { genomicTableFormatForLanguage, type GenomicTableFormat } from './genomic-table-parse'
import { structureFormatForLanguage } from './structure-format'

export type BioViewerFormat = GenomicTableFormat | 'fasta' | 'structure'

export function bioViewerFormatForLanguage(language: string): BioViewerFormat | null {
  if (language === 'fasta') {
    return 'fasta'
  }
  return structureFormatForLanguage(language)
    ? 'structure'
    : genomicTableFormatForLanguage(language)
}
