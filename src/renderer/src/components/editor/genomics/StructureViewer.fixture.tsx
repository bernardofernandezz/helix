import { defineFixture } from '../../../component-fixtures/component-fixture'
import StructureViewer from './StructureViewer'

// Trp-cage miniprotein backbone excerpt (PDB 1L2Y, model 1, chain A).
const PDB = [
  'ATOM      1  N   ASN A   1      -8.901   4.127  -0.555  1.00  0.00           N',
  'ATOM      2  CA  ASN A   1      -8.608   3.135  -1.618  1.00  0.00           C',
  'ATOM      3  C   ASN A   1      -7.117   2.964  -1.897  1.00  0.00           C',
  'ATOM      4  O   ASN A   1      -6.634   1.849  -1.758  1.00  0.00           O',
  'ATOM      5  N   LEU A   2      -6.379   4.031  -2.228  1.00  0.00           N',
  'ATOM      6  CA  LEU A   2      -4.923   4.002  -2.452  1.00  0.00           C',
  'ATOM      7  C   LEU A   2      -4.136   3.187  -1.404  1.00  0.00           C',
  'ATOM      8  O   LEU A   2      -3.391   2.274  -1.760  1.00  0.00           O',
  'ATOM      9  N   TYR A   3      -4.354   3.455  -0.111  1.00  0.00           N',
  'ATOM     10  CA  TYR A   3      -3.690   2.738   0.981  1.00  0.00           C',
  'ATOM     11  C   TYR A   3      -4.102   1.256   1.074  1.00  0.00           C',
  'ATOM     12  O   TYR A   3      -3.291   0.409   1.442  1.00  0.00           O',
  'ATOM     13  N   ILE A   4      -5.382   0.963   0.807  1.00  0.00           N',
  'ATOM     14  CA  ILE A   4      -6.001  -0.373   0.869  1.00  0.00           C',
  'ATOM     15  C   ILE A   4      -5.179  -1.401   0.074  1.00  0.00           C',
  'ATOM     16  O   ILE A   4      -4.816  -2.453   0.594  1.00  0.00           O',
  'HETATM   17  O   HOH A 101      -2.000   0.000   3.000  1.00  0.00           O',
  'END'
].join('\n')

export const protein = defineFixture({
  width: 900,
  render: () => (
    <div className="h-[360px]">
      <StructureViewer content={PDB} format="pdb" />
    </div>
  )
})
