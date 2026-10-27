import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { UpstreamError, createRequestSpacer, type HttpClient } from './http-client.js'
import { sourcedResult, textResult, truncateText, withToolErrors } from './tool-result.js'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'

const NCBI_DATABASES = [
  'gene',
  'nucleotide',
  'protein',
  'taxonomy',
  'assembly',
  'sra',
  'biosample',
  'bioproject',
  'clinvar',
  'snp',
  'gds',
  'pmc'
] as const

const esearchSchema = z.object({
  esearchresult: z.object({
    count: z.string(),
    idlist: z.array(z.string())
  })
})

const esummarySchema = z.object({
  result: z.record(z.string(), z.unknown()).optional()
})

const pubmedSummarySchema = z.object({
  uid: z.string(),
  title: z.string().optional(),
  pubdate: z.string().optional(),
  fulljournalname: z.string().optional(),
  source: z.string().optional(),
  authors: z.array(z.object({ name: z.string() })).optional(),
  articleids: z.array(z.object({ idtype: z.string(), value: z.string() })).optional()
})

export type NcbiCredentials = { apiKey?: string; email?: string }

export type EntrezClient = {
  search(
    db: string,
    term: string,
    retmax: number,
    sort?: string
  ): Promise<{ count: number; ids: string[] }>
  summaries(db: string, ids: string[]): Promise<Record<string, unknown>[]>
  fetchText(db: string, ids: string[], rettype: string): Promise<string>
}

export function createEntrezClient(http: HttpClient, credentials: NcbiCredentials): EntrezClient {
  const spacer = createRequestSpacer(credentials.apiKey ? 120 : 400)
  // NCBI counts requests per IP across clients, so a 429 can still happen; back off once.
  const spaced = <T>(task: () => Promise<T>): Promise<T> =>
    spacer(task).catch(async (error: unknown) => {
      if (!(error instanceof UpstreamError) || error.status !== 429) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 1_100))
      return spacer(task)
    })

  function url(tool: string, params: Record<string, string>): URL {
    const target = new URL(`${tool}.fcgi`, EUTILS_BASE)
    target.searchParams.set('tool', 'helix-mcp')
    if (credentials.email) {
      target.searchParams.set('email', credentials.email)
    }
    if (credentials.apiKey) {
      target.searchParams.set('api_key', credentials.apiKey)
    }
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value)
    }
    return target
  }

  return {
    async search(db, term, retmax, sort) {
      const params: Record<string, string> = { db, term, retmax: String(retmax), retmode: 'json' }
      if (sort) {
        params.sort = sort
      }
      const parsed = esearchSchema.parse(await spaced(() => http.getJson(url('esearch', params))))
      return { count: Number(parsed.esearchresult.count), ids: parsed.esearchresult.idlist }
    },
    async summaries(db, ids) {
      if (ids.length === 0) {
        return []
      }
      const parsed = esummarySchema.parse(
        await spaced(() =>
          http.getJson(url('esummary', { db, id: ids.join(','), retmode: 'json' }))
        )
      )
      return ids.flatMap((id) => {
        const doc = parsed.result?.[id]
        return isRecord(doc) ? [doc] : []
      })
    },
    async fetchText(db, ids, rettype) {
      return spaced(() =>
        http.getText(url('efetch', { db, id: ids.join(','), rettype, retmode: 'text' }))
      )
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function summarizePubmedRecord(doc: Record<string, unknown>) {
  const record = pubmedSummarySchema.parse(doc)
  const authors = (record.authors ?? []).map((author) => author.name)
  const doi = record.articleids?.find((id) => id.idtype === 'doi')?.value ?? null
  return {
    pmid: record.uid,
    title: record.title ?? '',
    authors: authors.length > 6 ? [...authors.slice(0, 6), 'et al.'] : authors,
    journal: record.fulljournalname ?? record.source ?? '',
    published: record.pubdate ?? '',
    doi,
    url: `https://pubmed.ncbi.nlm.nih.gov/${record.uid}/`
  }
}

const idList = z
  .array(z.string().regex(/^[A-Za-z0-9_.]+$/, 'identifiers contain only letters, digits, _ and .'))
  .min(1)
  .max(200)

export function registerNcbiTools(server: McpServer, entrez: EntrezClient): void {
  server.registerTool(
    'pubmed_search',
    {
      title: 'Search PubMed',
      description:
        'Search PubMed with Entrez syntax (e.g. "CRISPR[Title] AND 2023:2025[dp]") and return citations with PMID and DOI.',
      inputSchema: {
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(100).default(20),
        sort: z.enum(['relevance', 'pub_date']).default('relevance')
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ query, max_results, sort }) => {
      const found = await entrez.search('pubmed', query, max_results, sort)
      const docs = await entrez.summaries('pubmed', found.ids)
      return sourcedResult('PubMed (NCBI E-utilities)', {
        query,
        total: found.count,
        results: docs.map(summarizePubmedRecord)
      })
    })
  )

  server.registerTool(
    'pubmed_fetch_abstracts',
    {
      title: 'Fetch PubMed abstracts',
      description:
        'Fetch titles, authors, affiliations and abstracts for PubMed IDs as plain text.',
      inputSchema: { pmids: idList },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ pmids }) =>
      textResult(await entrez.fetchText('pubmed', pmids, 'abstract'))
    )
  )

  server.registerTool(
    'ncbi_search',
    {
      title: 'Search an NCBI database',
      description:
        'Search an Entrez database (gene, nucleotide, protein, taxonomy, assembly, sra, clinvar, snp, …) and return document summaries.',
      inputSchema: {
        database: z.enum(NCBI_DATABASES),
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(50).default(10)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ database, query, max_results }) => {
      const found = await entrez.search(database, query, max_results)
      const docs = await entrez.summaries(database, found.ids)
      return sourcedResult(`NCBI ${database}`, { query, total: found.count, results: docs })
    })
  )

  server.registerTool(
    'ncbi_fetch_sequence',
    {
      title: 'Fetch an NCBI sequence record',
      description:
        'Fetch nucleotide or protein records by accession as FASTA or GenBank flat file.',
      inputSchema: {
        database: z.enum(['nucleotide', 'protein']),
        accessions: idList,
        format: z.enum(['fasta', 'genbank']).default('fasta'),
        max_characters: z.number().int().min(1_000).max(500_000).default(50_000)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ database, accessions, format, max_characters }) => {
      const text = await entrez.fetchText(
        database,
        accessions,
        format === 'genbank' ? 'gb' : 'fasta'
      )
      return textResult(truncateText(text, max_characters))
    })
  )
}
