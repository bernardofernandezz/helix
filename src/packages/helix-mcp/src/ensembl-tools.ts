import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { HttpClient } from './http-client.js'
import { sourcedResult, textResult, truncateText, withToolErrors } from './tool-result.js'

const ENSEMBL_BASE = 'https://rest.ensembl.org/'

const STABLE_ID = /^ENS[A-Z]*[EGPRT]\d{11}(\.\d+)?$/
const SPECIES = z
  .string()
  .regex(/^[a-z_]+$/, 'use the Ensembl species name, e.g. homo_sapiens or mus_musculus')
  .default('homo_sapiens')

const vepSchema = z.array(
  z.object({
    input: z.string().optional(),
    id: z.string().optional(),
    seq_region_name: z.string().optional(),
    start: z.number().optional(),
    end: z.number().optional(),
    allele_string: z.string().optional(),
    most_severe_consequence: z.string().optional(),
    transcript_consequences: z
      .array(
        z.object({
          transcript_id: z.string(),
          gene_symbol: z.string().optional(),
          consequence_terms: z.array(z.string()),
          impact: z.string().optional(),
          amino_acids: z.string().optional(),
          protein_start: z.number().optional(),
          sift_prediction: z.string().optional(),
          polyphen_prediction: z.string().optional(),
          canonical: z.number().optional()
        })
      )
      .optional(),
    colocated_variants: z.array(z.object({ id: z.string() })).optional()
  })
)

const IMPACT_RANK: Record<string, number> = { HIGH: 0, MODERATE: 1, LOW: 2, MODIFIER: 3 }

export function summarizeVep(results: z.infer<typeof vepSchema>, maxTranscripts: number) {
  return results.map((variant) => {
    const consequences = [...(variant.transcript_consequences ?? [])].sort(
      (a, b) =>
        (IMPACT_RANK[a.impact ?? 'MODIFIER'] ?? 3) - (IMPACT_RANK[b.impact ?? 'MODIFIER'] ?? 3) ||
        (b.canonical ?? 0) - (a.canonical ?? 0)
    )
    return {
      input: variant.input ?? variant.id ?? null,
      location: variant.seq_region_name
        ? `${variant.seq_region_name}:${variant.start}-${variant.end}`
        : null,
      alleles: variant.allele_string ?? null,
      mostSevereConsequence: variant.most_severe_consequence ?? null,
      knownVariants: (variant.colocated_variants ?? []).map((known) => known.id),
      transcripts: consequences.slice(0, maxTranscripts).map((item) => ({
        transcript: item.transcript_id,
        gene: item.gene_symbol ?? null,
        canonical: item.canonical === 1,
        consequences: item.consequence_terms,
        impact: item.impact ?? null,
        aminoAcids: item.amino_acids ?? null,
        proteinPosition: item.protein_start ?? null,
        sift: item.sift_prediction ?? null,
        polyphen: item.polyphen_prediction ?? null
      }))
    }
  })
}

export function registerEnsemblTools(server: McpServer, http: HttpClient): void {
  const jsonHeaders = { headers: { 'Content-Type': 'application/json' } }

  server.registerTool(
    'ensembl_lookup',
    {
      title: 'Look up an Ensembl gene, transcript or protein',
      description:
        'Resolve a gene symbol (with species) or an Ensembl stable ID to its location, biotype, description and, optionally, transcripts.',
      inputSchema: {
        identifier: z
          .string()
          .min(1)
          .regex(/^[A-Za-z0-9_.-]+$/),
        species: SPECIES,
        include_transcripts: z.boolean().default(false)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ identifier, species, include_transcripts }) => {
      const path = STABLE_ID.test(identifier)
        ? `lookup/id/${identifier}`
        : `lookup/symbol/${species}/${identifier}`
      const url = new URL(path, ENSEMBL_BASE)
      url.searchParams.set('expand', include_transcripts ? '1' : '0')
      return sourcedResult('Ensembl REST', await http.getJson(url, jsonHeaders))
    })
  )

  server.registerTool(
    'ensembl_variant_effect',
    {
      title: 'Predict variant effects with Ensembl VEP',
      description:
        'Run Ensembl VEP on an HGVS notation (e.g. "ENST00000269305.9:c.817C>T", "9:g.22125504G>C") or an rsID, returning consequences, impact, SIFT and PolyPhen.',
      inputSchema: {
        variant: z.string().min(2).max(200),
        species: SPECIES,
        max_transcripts: z.number().int().min(1).max(50).default(5)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ variant, species, max_transcripts }) => {
      const kind = /^rs\d+$/.test(variant) ? 'id' : 'hgvs'
      const url = new URL(`vep/${species}/${kind}/${encodeURIComponent(variant)}`, ENSEMBL_BASE)
      const results = vepSchema.parse(await http.getJson(url, jsonHeaders))
      return sourcedResult('Ensembl VEP', summarizeVep(results, max_transcripts))
    })
  )

  server.registerTool(
    'ensembl_sequence',
    {
      title: 'Fetch a sequence from Ensembl',
      description:
        'Fetch genomic, cDNA, CDS or protein sequence for an Ensembl stable ID as FASTA.',
      inputSchema: {
        stable_id: z
          .string()
          .regex(STABLE_ID, 'expected an Ensembl stable ID such as ENSG00000141510'),
        type: z.enum(['genomic', 'cdna', 'cds', 'protein']).default('genomic'),
        max_characters: z.number().int().min(1_000).max(500_000).default(50_000)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ stable_id, type, max_characters }) => {
      const url = new URL(`sequence/id/${stable_id}`, ENSEMBL_BASE)
      url.searchParams.set('type', type)
      url.searchParams.set('content-type', 'text/x-fasta')
      return textResult(truncateText(await http.getText(url), max_characters))
    })
  )
}
