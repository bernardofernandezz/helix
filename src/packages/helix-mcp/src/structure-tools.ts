import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { HttpClient } from './http-client.js'
import { sourcedResult, withToolErrors } from './tool-result.js'

const RCSB_SEARCH = 'https://search.rcsb.org/rcsbsearch/v2/query'
const RCSB_GRAPHQL = 'https://data.rcsb.org/graphql'
const ALPHAFOLD_API = 'https://alphafold.ebi.ac.uk/api/prediction/'

const PDB_ID = /^[0-9][A-Za-z0-9]{3}$/
const UNIPROT_ACCESSION = /^[A-Z0-9]{6,10}$/

const searchSchema = z.object({
  total_count: z.number(),
  result_set: z.array(z.object({ identifier: z.string(), score: z.number().optional() }))
})

const entrySchema = z.object({
  rcsb_id: z.string(),
  struct: z.object({ title: z.string().nullable() }).nullable().optional(),
  exptl: z
    .array(z.object({ method: z.string() }))
    .nullable()
    .optional(),
  rcsb_entry_info: z
    .object({
      resolution_combined: z.array(z.number()).nullable().optional(),
      polymer_entity_count: z.number().nullable().optional(),
      deposited_atom_count: z.number().nullable().optional()
    })
    .nullable()
    .optional(),
  rcsb_accession_info: z
    .object({ initial_release_date: z.string().nullable().optional() })
    .nullable()
    .optional(),
  rcsb_primary_citation: z
    .object({
      title: z.string().nullable().optional(),
      pdbx_database_id_PubMed: z.number().nullable().optional(),
      pdbx_database_id_DOI: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  polymer_entities: z
    .array(
      z.object({
        rcsb_polymer_entity: z
          .object({ pdbx_description: z.string().nullable().optional() })
          .nullable()
          .optional(),
        rcsb_entity_source_organism: z
          .array(z.object({ scientific_name: z.string().nullable().optional() }))
          .nullable()
          .optional(),
        rcsb_polymer_entity_container_identifiers: z
          .object({ uniprot_ids: z.array(z.string()).nullable().optional() })
          .nullable()
          .optional()
      })
    )
    .nullable()
    .optional()
})

const graphqlSchema = z.object({
  data: z
    .object({ entries: z.array(entrySchema.nullable()).nullable() })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional()
})

const ENTRY_QUERY = `query ($ids: [String!]!) {
  entries(entry_ids: $ids) {
    rcsb_id
    struct { title }
    exptl { method }
    rcsb_entry_info { resolution_combined polymer_entity_count deposited_atom_count }
    rcsb_accession_info { initial_release_date }
    rcsb_primary_citation { title pdbx_database_id_PubMed pdbx_database_id_DOI }
    polymer_entities {
      rcsb_polymer_entity { pdbx_description }
      rcsb_entity_source_organism { scientific_name }
      rcsb_polymer_entity_container_identifiers { uniprot_ids }
    }
  }
}`

const alphafoldSchema = z.array(
  z.object({
    entryId: z.string(),
    gene: z.string().nullable().optional(),
    uniprotAccession: z.string().optional(),
    uniprotDescription: z.string().nullable().optional(),
    organismScientificName: z.string().nullable().optional(),
    uniprotStart: z.number().optional(),
    uniprotEnd: z.number().optional(),
    latestVersion: z.number().optional(),
    globalMetricValue: z.number().nullable().optional(),
    pdbUrl: z.string().optional(),
    cifUrl: z.string().optional(),
    paeImageUrl: z.string().optional()
  })
)

export function summarizePdbEntry(entry: z.infer<typeof entrySchema>) {
  const id = entry.rcsb_id
  const citation = entry.rcsb_primary_citation
  return {
    id,
    title: entry.struct?.title ?? null,
    methods: (entry.exptl ?? []).map((item) => item.method),
    resolutionAngstrom: entry.rcsb_entry_info?.resolution_combined?.[0] ?? null,
    released: entry.rcsb_accession_info?.initial_release_date?.slice(0, 10) ?? null,
    entities: (entry.polymer_entities ?? []).map((entity) => ({
      description: entity.rcsb_polymer_entity?.pdbx_description ?? null,
      organisms: (entity.rcsb_entity_source_organism ?? []).flatMap((source) =>
        source.scientific_name ? [source.scientific_name] : []
      ),
      uniprot: entity.rcsb_polymer_entity_container_identifiers?.uniprot_ids ?? []
    })),
    citation: citation
      ? {
          title: citation.title ?? null,
          pmid: citation.pdbx_database_id_PubMed ?? null,
          doi: citation.pdbx_database_id_DOI ?? null
        }
      : null,
    url: `https://www.rcsb.org/structure/${id}`,
    mmcif: `https://files.rcsb.org/download/${id}.cif`
  }
}

export function registerStructureTools(server: McpServer, http: HttpClient): void {
  async function fetchEntries(ids: string[]) {
    const parsed = graphqlSchema.parse(
      await http.postJson(RCSB_GRAPHQL, { body: { query: ENTRY_QUERY, variables: { ids } } })
    )
    if (parsed.errors?.length) {
      throw new Error(`RCSB: ${parsed.errors.map((error) => error.message).join('; ')}`)
    }
    return (parsed.data?.entries ?? []).flatMap((entry) =>
      entry ? [summarizePdbEntry(entry)] : []
    )
  }

  server.registerTool(
    'pdb_search',
    {
      title: 'Search the Protein Data Bank',
      description:
        'Full-text search of RCSB PDB (protein names, ligands, organisms, authors) returning entry summaries.',
      inputSchema: {
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(50).default(10)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ query, max_results }) => {
      const raw = await http.postJson(RCSB_SEARCH, {
        allowEmpty: true,
        body: {
          query: { type: 'terminal', service: 'full_text', parameters: { value: query } },
          return_type: 'entry',
          request_options: { paginate: { start: 0, rows: max_results } }
        }
      })
      if (raw === null) {
        return sourcedResult('RCSB PDB', { query, total: 0, results: [] })
      }
      const found = searchSchema.parse(raw)
      const results = await fetchEntries(found.result_set.map((hit) => hit.identifier))
      return sourcedResult('RCSB PDB', { query, total: found.total_count, results })
    })
  )

  server.registerTool(
    'pdb_entry',
    {
      title: 'Get PDB entries',
      description:
        'Get title, method, resolution, chains with UniProt mapping, citation and download links for PDB IDs.',
      inputSchema: {
        ids: z
          .array(z.string().regex(PDB_ID, 'expected a 4-character PDB ID such as 1TUP'))
          .min(1)
          .max(50)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ ids }) =>
      sourcedResult('RCSB PDB', await fetchEntries(ids.map((id) => id.toUpperCase())))
    )
  )

  server.registerTool(
    'alphafold_prediction',
    {
      title: 'Get an AlphaFold DB prediction',
      description:
        'Get the AlphaFold DB model for a UniProt accession: mean pLDDT confidence, covered residues and model file URLs.',
      inputSchema: {
        uniprot_accession: z.string().regex(UNIPROT_ACCESSION, 'expected a UniProt accession')
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ uniprot_accession }) => {
      const raw = await http.getJson(new URL(uniprot_accession, ALPHAFOLD_API), {
        allowEmpty: true
      })
      const models = raw === null ? [] : alphafoldSchema.parse(raw)
      return sourcedResult('AlphaFold Protein Structure Database', {
        accession: uniprot_accession,
        found: models.length > 0,
        models: models.map((model) => ({
          id: model.entryId,
          gene: model.gene ?? null,
          description: model.uniprotDescription ?? null,
          organism: model.organismScientificName ?? null,
          residues:
            model.uniprotStart && model.uniprotEnd ? [model.uniprotStart, model.uniprotEnd] : null,
          version: model.latestVersion ?? null,
          meanPlddt: model.globalMetricValue ?? null,
          pdb: model.pdbUrl ?? null,
          mmcif: model.cifUrl ?? null,
          paeImage: model.paeImageUrl ?? null
        }))
      })
    })
  )
}
