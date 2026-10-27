import { defineFixture } from '../../../component-fixtures/component-fixture'
import FastaViewer from './FastaViewer'

const FASTA = [
  '>NM_000546.6 Homo sapiens tumor protein p53 (TP53), transcript variant 1, mRNA',
  'CTCAAAAGTCTAGAGCCACCGTCCAGGGAGCAGGTAGCTGCTGGGCTCCGGGGACACTTTGCGTTCGGGCTGGGAGCGTG',
  'CTTTCCACGACGGTGACACGCTTCCCTGGATTGGCAGCCAGACTGCCTTCCGGGTCACTGCCATGGAGGAGCCGCAGTCA',
  '>NM_007294.4 Homo sapiens BRCA1 DNA repair associated (BRCA1), transcript variant 1, mRNA',
  'GCTGAGACTTCCTGGACGGGGGACAGGCTGTGGGGTTTCTCAGATAACTGGGCCCCTGCGCTCAGGAGGCCTTCACCCTC'
].join('\n')

export const nucleotide = defineFixture({
  width: 900,
  render: () => (
    <div className="h-[280px]">
      <FastaViewer content={FASTA} />
    </div>
  )
})
