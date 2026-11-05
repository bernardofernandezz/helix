---
name: sequence-design
description: Sequence search and molecular biology design - BLAST, primers, CRISPR guides, cloning,
  plasmids, codon optimization, translation. Use for genetic engineering and cloning questions or
  FASTA/GenBank files.
---

# Sequence search and molecular design

## Search and identify

- Small queries: NCBI BLAST remote (`blastn/blastp -remote -db nt|nr`) or the helix-research
  `ncbi_search`/`uniprot_search` tools. Many queries or private data: local BLAST+ or `mmseqs2`.
- Report top hits with identity, coverage, e-value, organism and accession.

## Primers (Primer3)

Use `primer3-py`. Defaults: 18-25 nt, Tm 58-62 °C (pair ΔTm ≤ 2 °C), GC 40-60%, amplicon as requested,
avoid 3' GC runs. Check specificity with BLAST against the target genome and self/hetero-dimers.
Return a table: name, sequence 5'→3', Tm, GC%, amplicon size, position.

## CRISPR guides

Identify PAM sites for the chosen nuclease (SpCas9 NGG by default; ask if Cas12a etc.). Score on-target
(e.g. Rule Set 2/Doench via `crisporWebsite` tools or `flashfry`) and off-targets against the genome.
Prefer guides in early coding exons for knockouts. Show guides on the sequence (helix-bio-visuals).

## Cloning and plasmids

- Read/write GenBank with Biopython (`SeqIO`), keep features and annotations.
- Restriction analysis with `Bio.Restriction`; Gibson/Golden Gate overlaps with explicit overhangs.
- Output final constructs as annotated GenBank in `results/constructs/` and a feature map visual.

## Codon optimization and translation

Translate all frames when the frame is unknown. For optimization, use the host organism's codon usage
(`dnachisel` or `python-codon-tables`), avoid internal restriction sites the user needs, and report CAI
before/after.
