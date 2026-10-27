import { afterEach, describe, expect, it, vi } from 'vitest'
import { Document, stringify } from 'yaml'
import {
  MAX_HELIX_YAML_BYTES,
  MAX_HELIX_YAML_COLLECTION_ENTRIES,
  MAX_HELIX_YAML_FIELD_BYTES,
  MAX_HELIX_YAML_FIELD_CODE_UNITS
} from './helix-yaml-file-limit'
import { parseHelixYaml } from './helix-yaml'

afterEach(() => vi.restoreAllMocks())

describe('helix.yaml parse bounds', () => {
  it('admits the exact UTF-8 input boundary and rejects +1 before conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    const prefix = 'scripts:\n  setup: pnpm install\n#'
    const exact = prefix + ' '.repeat(MAX_HELIX_YAML_BYTES - prefix.length)
    expect(parseHelixYaml(exact)).toMatchObject({ scripts: { setup: 'pnpm install' } })
    expect(toJS).toHaveBeenCalledOnce()
    toJS.mockClear()
    expect(parseHelixYaml(`${exact} `)).toBeNull()
    expect(toJS).not.toHaveBeenCalled()
  })

  it('rejects a multibyte input over the byte cap before conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    expect(parseHelixYaml('é'.repeat(MAX_HELIX_YAML_BYTES / 2 + 1))).toBeNull()
    expect(toJS).not.toHaveBeenCalled()
  })

  it('preserves exact-size fields and drops a field at +1 code unit', () => {
    const exact = 'x'.repeat(MAX_HELIX_YAML_FIELD_CODE_UNITS)
    expect(parseHelixYaml(stringify({ scripts: { setup: exact } }))).toMatchObject({
      scripts: { setup: exact }
    })
    expect(parseHelixYaml(stringify({ scripts: { setup: `${exact}x` } }))).toBeNull()
    const exactUtf8 = 'é'.repeat(MAX_HELIX_YAML_FIELD_BYTES / 2)
    expect(parseHelixYaml(stringify({ scripts: { setup: exactUtf8 } }))).toMatchObject({
      scripts: { setup: exactUtf8 }
    })
    expect(parseHelixYaml(stringify({ scripts: { setup: `${exactUtf8}é` } }))).toBeNull()
  })

  it('admits the exact collection boundary and rejects +1 entries', () => {
    const tabs = Array.from({ length: MAX_HELIX_YAML_COLLECTION_ENTRIES }, (_, index) => ({
      title: `tab-${index}`
    }))
    expect(parseHelixYaml(stringify({ defaultTabs: tabs }))?.defaultTabs).toHaveLength(
      MAX_HELIX_YAML_COLLECTION_ENTRIES
    )
    expect(parseHelixYaml(stringify({ defaultTabs: [...tabs, { title: 'overflow' }] }))).toBeNull()
  })
})
