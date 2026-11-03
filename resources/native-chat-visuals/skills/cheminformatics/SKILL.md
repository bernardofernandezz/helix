---
name: cheminformatics
description:
  Small-molecule chemistry with RDKit - SMILES/SDF/MOL handling, properties, drug-likeness,
  similarity, substructure search, ChEMBL/PubChem lookups and docking preparation. Use for chemistry,
  compound library or drug discovery questions.
---

# Cheminformatics

- Parse with RDKit (`Chem.MolFromSmiles`, `Chem.SDMolSupplier`); report and skip invalid entries
  rather than failing. Standardize (largest fragment, neutralize, canonical tautomer) before comparing.
- Properties: MW, cLogP, TPSA, HBD, HBA, rotatable bonds, QED; flag Lipinski/Veber violations and PAINS
  alerts (`FilterCatalog`). Save to `results/chem/properties.csv`.
- Similarity: Morgan fingerprints radius 2, 2048 bits, Tanimoto. Cluster with Butina (cutoff 0.35 by
  default) for diverse subsets.
- Substructure: SMARTS queries; highlight matched atoms in depictions.
- Lookups: PubChem PUG REST and ChEMBL (`chembl_webresource_client`) for names, targets and bioactivity
  (IC50/Ki with units and assay IDs).
- 3D and docking: ETKDG conformers + MMFF optimization; protonate at pH 7.4 (`dimorphite_dl` or
  `openbabel`); receptor from PDB/AlphaFold; dock with AutoDock Vina or `gnina`. Show the best pose with
  the receptor in 3D (helix-bio-visuals) and report scores as estimates, not affinities.

Show molecules as 2D grids (helix-bio-visuals) rather than raw SMILES whenever more than one is
discussed.
