---
name: ngs-qc-alignment
description: Quality control, trimming and alignment of sequencing reads (FASTQ to BAM). Use when
  the user has FASTQ files, asks about read quality, adapters, mapping rate, or needs BAM files.
---

# NGS quality control and alignment

1. Inventory: list FASTQ files, detect paired-end pairs (`_R1`/`_R2`, `_1`/`_2`), read length and
   count (`seqkit stats -a`). Ask for organism and library type only if not inferable.
2. QC: `fastqc -t 4 -o data/processed/qc` then `multiqc data/processed/qc -o results/qc`. Report per
   sample: reads, %GC, duplication, adapter content, failing modules, in a short table.
3. Trimming (only if adapters or low quality): `fastp` with `--detect_adapter_for_pe` for paired data;
   keep the HTML/JSON reports.
4. Reference: download from Ensembl or NCBI with the release recorded; index once in
   `data/processed/reference/`.
5. Alignment:
   - DNA: `bwa-mem2 mem -t N -R '@RG\tID:S\tSM:S'` | `samtools sort` then `samtools index`.
   - RNA: `STAR` (enough RAM) or `hisat2`; for quantification only, prefer `salmon quant` (see
     rnaseq-differential-expression).
   - Long reads: `minimap2 -ax map-ont` or `map-hifi`.
6. Post-alignment: `samtools flagstat`, `samtools stats`, `mosdepth` for coverage. Report mapping
   rate, properly paired %, duplication and mean coverage; flag samples below 80% mapping.

Large runs: estimate time and disk first; offer a Snakemake/Nextflow workflow in `workflows/` (e.g.
nf-core/rnaseq, nf-core/sarek) and SLURM submission when a cluster is available.
