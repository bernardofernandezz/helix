import { describe, expect, it } from 'vitest'
import { analysisDirFor, folderWorkspacePath } from './folder-workspace-analysis-dir'

describe('folder workspace analysis dir', () => {
  it('slugs names, suffixes collisions and falls back for empty slugs', () => {
    expect(analysisDirFor('RNA-seq DE', 1)).toBe('analyses/rna-seq-de')
    expect(analysisDirFor('RNA-seq DE', 3)).toBe('analyses/rna-seq-de-3')
    expect(analysisDirFor('!!!', 1)).toBe('analyses/analysis')
  })

  it('joins with the project path flavor and rejects escaping dirs', () => {
    expect(folderWorkspacePath('/p', undefined)).toBe('/p')
    expect(folderWorkspacePath('/p', 'analyses/a')).toBe('/p/analyses/a')
    expect(folderWorkspacePath('C:\\p', 'analyses/a')).toBe('C:\\p\\analyses\\a')
    expect(folderWorkspacePath('/p', 'analyses/../../etc')).toBe('/p')
    expect(folderWorkspacePath('/p', '/etc')).toBe('/p')
  })
})
