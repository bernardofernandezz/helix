---
name: variant-analysis
description: Call, filter and annotate genetic variants (BAM/VCF). Use for SNPs, indels, mutations,
  genotyping, VCF files, variant effect or clinical interpretation questions.
---

# Variant calling and annotation

1. Inputs: sorted, indexed BAMs (see ngs-qc-alignment) and the exact reference used for alignment.
   For VCFs, check the reference build in the header (`bcftools view -h`) and never mix builds.
2. Calling:
   - Germline small variants: `bcftools mpileup -f ref.fa -a AD,DP | bcftools call -mv -Oz`, or GATK
     HaplotypeCaller / DeepVariant for clinical-grade work.
   - Haploid organisms (bacteria, viruses): `bcftools call --ploidy 1` or `freebayes -p 1`.
   - Somatic: Mutect2 with a matched normal; say so if no normal is available.
3. Filtering: start with QUAL ≥ 30, DP ≥ 10, and allele balance; `bcftools norm -m-` to split
   multiallelics. Report counts before and after each filter.
4. Annotation: Ensembl VEP (`ensembl_variant_effect` MCP tool for small sets, local VEP or SnpEff for
   many), plus ClinVar/gnomAD frequencies when relevant.
5. Report: `results/variants/annotated.tsv` and an inline table of high-impact variants (gene,
   HGVS c./p., consequence, frequency, ClinVar). Add IGV-style read context only on request.

Never present a variant as clinically actionable; say interpretation needs a qualified geneticist.
