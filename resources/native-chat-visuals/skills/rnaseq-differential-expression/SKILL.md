---
name: rnaseq-differential-expression
description: Bulk RNA-seq quantification, differential expression and enrichment. Use when the user
  wants to compare conditions, find differentially expressed genes, or has a counts matrix.
---

# Bulk RNA-seq differential expression

1. Sample sheet: build `data/processed/samples.csv` (sample, condition, batch, replicate, fastq paths).
   Confirm the comparison (e.g. treated vs control) and whether there is a batch.
2. Quantification from FASTQ: `salmon index` on the transcriptome (Ensembl cDNA, same release as the
   GTF) and `salmon quant -l A --validateMappings`; import with `tximport` (R) or `pytximport`.
   If the user already has counts, validate gene IDs and skip this.
3. Exploration: VST/rlog, PCA colored by condition and batch, sample-distance heatmap. Point out
   outliers and batch effects before testing.
4. Testing: DESeq2 (R) or `pydeseq2` with design `~ batch + condition` when batch exists; apeglm
   shrinkage for fold changes. Defaults: padj < 0.05 and |log2FC| > 1, stated explicitly.
5. Output: `results/de/<contrast>.csv` with gene symbol, baseMean, log2FC, padj; volcano and MA plots
   inline (helix-bio-visuals); top 20 genes in a table with one-line biological notes.
6. Enrichment: GO/KEGG/Reactome over-representation (clusterProfiler or `gseapy`) and GSEA on the
   ranked list; report terms with adjusted p-values, not just names.

Warn when replicates < 3 per group; results are then exploratory.
