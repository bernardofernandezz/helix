import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { HttpClient } from './http-client.js'
import { sourcedResult, textResult, withToolErrors } from './tool-result.js'

const UNIPROT_BASE = 'https://rest.uniprot.org/uniprotkb/'

const valueSchema = z.object({ value: z.string() })

const uniprotEntrySchema = z.object({
  primaryAccession: z.string(),
  uniProtkbId: z.string().optional(),
  entryType: z.string().optional(),
  proteinDescription: z
    .object({
      recommendedName: z.object({ fullName: valueSchema }).optional(),
      submissionNames: z.array(z.object({ fullName: valueSchema })).optional()
    })
    .optional(),
  genes: z.array(z.object({ geneName: valueSchema.optional() })).optional(),
  organism: z.object({ scientificName: z.string(), taxonId: z.number().optional() }).optional(),
  sequence: z.object({ length: z.number(), value: z.string().optional() }).optional(),
  comments: z
    .array(
      z.object({
        commentType: z.string(),
        texts: z.array(valueSchema).optional(),
        subcellularLocations: z.array(z.object({ location: valueSchema.optional() })).optional()
      })
    )
    .optional(),
  keywords: z.array(z.object({ name: z.string() })).optional(),
  uniProtKBCrossReferences: z.array(z.object({ database: z.string(), id: z.string() })).optional()
})

type UniprotEntry = z.infer<typeof uniprotEntrySchema>

const searchSchema = z.object({ results: z.array(uniprotEntrySchema) })

const ACCESSION = /^[A-Z0-9]{6,10}(-\d+)?$/

function proteinName(entry: UniprotEntry): string {
  const description = entry.proteinDescription
  return (
    description?.recommendedName?.fullName.value ??
    description?.submissionNames?.[0]?.fullName.value ??
    ''
  )
}

export function summarizeUniprotEntry(entry: UniprotEntry) {
  return {
    accession: entry.primaryAccession,
    id: entry.uniProtkbId ?? null,
    reviewed: entry.entryType ? !entry.entryType.includes('unreviewed') : null,
    protein: proteinName(entry),
    genes: (entry.genes ?? []).flatMap((gene) => (gene.geneName ? [gene.geneName.value] : [])),
    organism: entry.organism?.scientificName ?? null,
    taxonId: entry.organism?.taxonId ?? null,
    length: entry.sequence?.length ?? null,
    url: `https://www.uniprot.org/uniprotkb/${entry.primaryAccession}`
  }
}

export function describeUniprotEntry(entry: UniprotEntry) {
  const comments = entry.comments ?? []
  const crossRefs = entry.uniProtKBCrossReferences ?? []
  const idsFor = (database: string) =>
    crossRefs.filter((ref) => ref.database === database).map((ref) => ref.id)
  return {
    ...summarizeUniprotEntry(entry),
    function: comments
      .filter((comment) => comment.commentType === 'FUNCTION')
      .flatMap((comment) => (comment.texts ?? []).map((text) => text.value)),
    subcellularLocation: comments
      .filter((comment) => comment.commentType === 'SUBCELLULAR LOCATION')
      .flatMap((comment) =>
        (comment.subcellularLocations ?? []).flatMap((place) =>
          place.location ? [place.location.value] : []
        )
      ),
    keywords: (entry.keywords ?? []).map((keyword) => keyword.name),
    structures: { pdb: idsFor('PDB'), alphafold: idsFor('AlphaFoldDB') },
    ensembl: idsFor('Ensembl'),
    sequence: entry.sequence?.value ?? null
  }
}

export function registerUniprotTools(server: McpServer, http: HttpClient): void {
  server.registerTool(
    'uniprot_search',
    {
      title: 'Search UniProtKB',
      description:
        'Search UniProtKB with its query syntax (e.g. "gene:TP53 AND organism_id:9606 AND reviewed:true").',
      inputSchema: {
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(100).default(20)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ query, max_results }) => {
      const url = new URL('search', UNIPROT_BASE)
      url.searchParams.set('query', query)
      url.searchParams.set('size', String(max_results))
      url.searchParams.set('format', 'json')
      url.searchParams.set(
        'fields',
        'accession,id,protein_name,gene_names,organism_name,organism_id,length,reviewed'
      )
      const parsed = searchSchema.parse(await http.getJson(url))
      return sourcedResult('UniProtKB', {
        query,
        results: parsed.results.map(summarizeUniprotEntry)
      })
    })
  )

  server.registerTool(
    'uniprot_entry',
    {
      title: 'Get a UniProtKB entry',
      description:
        'Get one UniProtKB entry: function, location, keywords, PDB/AlphaFold/Ensembl links and sequence, or the FASTA only.',
      inputSchema: {
        accession: z.string().regex(ACCESSION, 'expected a UniProt accession such as P04637'),
        format: z.enum(['summary', 'fasta']).default('summary')
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ accession, format }) => {
      if (format === 'fasta') {
        return textResult(await http.getText(new URL(`${accession}.fasta`, UNIPROT_BASE)))
      }
      const entry = uniprotEntrySchema.parse(
        await http.getJson(new URL(`${accession}.json`, UNIPROT_BASE))
      )
      return sourcedResult('UniProtKB', describeUniprotEntry(entry))
    })
  )
}
