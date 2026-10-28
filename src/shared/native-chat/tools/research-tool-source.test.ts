import { describe, expect, it } from 'vitest'
import { researchToolSource } from './research-tool-source'

describe('researchToolSource', () => {
  it('names research tools by their source', () => {
    expect(
      researchToolSource({ server: 'helix-research', tool: 'pubmed_fetch_abstracts' })
    ).toEqual({ server: 'PubMed', tool: 'fetch abstracts' })
    expect(researchToolSource({ server: 'helix-research', tool: 'clinvar' })).toEqual({
      server: 'ClinVar',
      tool: 'clinvar'
    })
  })

  it('leaves other servers and unknown tools alone', () => {
    expect(researchToolSource({ server: 'github', tool: 'pubmed_search' })).toBeNull()
    expect(researchToolSource({ server: 'helix-research', tool: 'gene_lookup' })).toBeNull()
  })
})
