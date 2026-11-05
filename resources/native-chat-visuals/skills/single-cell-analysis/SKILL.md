---
name: single-cell-analysis
description:
  Single-cell RNA-seq analysis with scanpy - QC, normalization, clustering, annotation and
  differential expression. Use for 10x/h5ad/mtx data, cell types, UMAP or clusters.
---

# Single-cell RNA-seq (scanpy)

1. Load: `sc.read_10x_h5`, `sc.read_10x_mtx` or `.h5ad`; one AnnData per sample with `obs['sample']`,
   then concatenate. Report cells and genes per sample.
2. QC: mitochondrial (`MT-`/`mt-`) and ribosomal fractions, genes per cell, counts per cell; propose
   thresholds from the distributions (show violin plots) instead of fixed numbers. Remove doublets with
   `scrublet` or `scDblFinder`.
3. Normalize: `normalize_total(target_sum=1e4)`, `log1p`, highly variable genes (2000), scale, PCA.
   Integrate samples with Harmony (`scanpy.external.pp.harmony_integrate`) or scVI when batches differ.
4. Cluster: neighbors, Leiden (resolution 0.5 default, state it), UMAP colored by cluster and sample.
5. Annotate: marker genes (`rank_genes_groups`, Wilcoxon) plus known markers for the tissue;
   CellTypist when a model fits. Mark uncertain clusters as such.
6. Compare conditions: pseudobulk per sample and cluster, then DESeq2/pydeseq2; never treat cells as
   replicates.

Save the final object to `data/processed/<name>.h5ad` and figures to `results/singlecell/`.
