import { defineFixture } from '../../../component-fixtures/component-fixture'
import GenomicTableViewer from './GenomicTableViewer'

const VCF = [
  '##fileformat=VCFv4.2',
  '##reference=GRCh38',
  '##INFO=<ID=DP,Number=1,Type=Integer,Description="Total depth">',
  '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tTUMOR\tNORMAL',
  'chr17\t7675088\trs28934578\tC\tT\t812\tPASS\tDP=96\tGT:AD\t0/1:48,48\t0/0:60,0',
  'chr17\t7676154\trs1042522\tG\tC\t990\tPASS\tDP=120\tGT:AD\t1/1:0,120\t1/1:0,98',
  'chr13\t32340300\t.\tA\tG\t35\tq10\tDP=7\tGT:AD\t0/1:4,3\t./.:.'
].join('\n')

const GFF = [
  '##gff-version 3',
  'chr17\tensembl\tgene\t7661779\t7687538\t.\t-\t.\tID=gene:ENSG00000141510;Name=TP53',
  'chr17\tensembl\tmRNA\t7661779\t7687538\t.\t-\t.\tID=transcript:ENST00000269305;Parent=gene:ENSG00000141510',
  'chr17\tensembl\texon\t7687377\t7687538\t.\t-\t.\tParent=transcript:ENST00000269305'
].join('\n')

export const vcf = defineFixture({
  width: 900,
  render: () => (
    <div className="h-[260px]">
      <GenomicTableViewer content={VCF} format="vcf" />
    </div>
  )
})

export const gff = defineFixture({
  width: 900,
  render: () => (
    <div className="h-[200px]">
      <GenomicTableViewer content={GFF} format="gff" />
    </div>
  )
})
