---
name: helix-bio-visuals
description: Show protein and ligand 3D structures, molecules, sequences, alignments and scientific
  plots inline in a Helix chat. Use with helix-chat-visuals whenever the user asks to see or compare
  a structure, molecule, sequence, alignment, volcano/MA plot, heatmap or coverage plot.
user-invocable: false
---

# Scientific visuals in a Helix chat

Follow `helix-chat-visuals` for where to save the HTML file and how to show it. The page cannot make
network requests, so embed all data inline (keep the file under 512 KB). Load libraries only from the
pinned CDN URLs below.

## 3D structures (PDB, mmCIF, AlphaFold, docking poses)

Fetch the file yourself (helix-research `pdb_entry` / `alphafold_prediction`, or RCSB), keep only the
chains you need if it is large, and inline the text:

```html
<div id="v" style="width:100%;height:420px;position:relative"></div>
<script src="https://cdn.jsdelivr.net/npm/3dmol@2.4.2/build/3Dmol-min.js"></script>
<script>
  const pdb = `...PDB TEXT...`
  const viewer = $3Dmol.createViewer('v', { backgroundAlpha: 0 })
  viewer.addModel(pdb, 'pdb') // 'cif' for mmCIF, 'sdf' or 'mol2' for ligands
  viewer.setStyle({}, { cartoon: { color: 'spectrum' } })
  viewer.setStyle({ hetflag: true }, { stick: {} })
  viewer.zoomTo()
  viewer.render()
</script>
```

Color AlphaFold models by pLDDT (B-factor column): `{cartoon:{colorscheme:{prop:'b',gradient:'roygb',min:50,max:90}}}`.

## Small molecules

Draw 2D depictions with RDKit in Python and inline the SVG (`rdkit.Chem.Draw.MolsToGridImage(...,
useSVG=True)`), with name, SMILES and key properties (MW, cLogP, TPSA, HBD/HBA) underneath.

## Sequences and alignments

Render as a monospace HTML table: 60 residues per row with position numbers, color residues by
property (Clustal-like) and mark features (primers, guides, mutations, domains) with background
highlights and a legend. For alignments, add a consensus row and conservation bar.

## Plots

Use Plotly with inline data and theme variables:

```html
<div id="p"></div>
<script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"></script>
```

Good defaults: volcano (log2FC vs -log10 padj, label top hits), MA plot, PCA with sample labels,
clustered heatmap of z-scores, coverage along a gene, dose-response curves with fitted IC50. Downsample
to a few thousand points when needed and say so.
