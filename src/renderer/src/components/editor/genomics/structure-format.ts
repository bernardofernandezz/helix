/** Editor languages that 3Dmol parses directly; the value is 3Dmol's format name. */
const STRUCTURE_LANGUAGE_FORMATS: Record<string, string> = {
  pdb: 'pdb',
  mmcif: 'cif',
  sdf: 'sdf',
  mol2: 'mol2',
  xyz: 'xyz'
}

export function structureFormatForLanguage(language: string): string | null {
  return STRUCTURE_LANGUAGE_FORMATS[language] ?? null
}

export type StructureSummary = {
  atoms: number
  chains: string[]
  /** Ligand residue names (HETATM, excluding water). */
  ligands: string[]
  molecules: number
}

const WATER = new Set(['HOH', 'WAT', 'DOD'])

/** Cheap text summary for the header; 3Dmol does the real parsing. */
export function summarizeStructure(content: string, format: string): StructureSummary {
  if (format === 'sdf') {
    const molecules = content.split(/^\$\$\$\$\s*$/m).filter((block) => block.trim()).length
    return { atoms: 0, chains: [], ligands: [], molecules }
  }
  if (format !== 'pdb') {
    return { atoms: 0, chains: [], ligands: [], molecules: 1 }
  }
  const chains = new Set<string>()
  const ligands = new Set<string>()
  let atoms = 0
  for (const line of content.split('\n')) {
    const record = line.slice(0, 6)
    if (record !== 'ATOM  ' && record !== 'HETATM') {
      continue
    }
    atoms++
    const chain = line[21]?.trim()
    if (chain) {
      chains.add(chain)
    }
    const residue = line.slice(17, 20).trim()
    if (record === 'HETATM' && residue && !WATER.has(residue)) {
      ligands.add(residue)
    }
  }
  return { atoms, chains: [...chains], ligands: [...ligands], molecules: 1 }
}
