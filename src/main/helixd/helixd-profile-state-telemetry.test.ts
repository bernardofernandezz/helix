import { describe, expect, it } from 'vitest'
import {
  emitHelixdProfileStateAuthoritySelected,
  formatHelixdProfileStateAuthoritySelected,
  type HelixdProfileStateAuthoritySelection
} from './helixd-profile-state-telemetry'

const selection: HelixdProfileStateAuthoritySelection = {
  backend: 'sqlite',
  classification: 'json-only',
  authority_mode: 'sqlite-established',
  runtime: 'helixd',
  migrated: true
}

describe('helixd profile-state telemetry', () => {
  it('strips unexpected runtime fields before writing the record', () => {
    const selectionWithRuntimeFields = Object.assign({}, selection, {
      database_path: '/private/profile-state.db'
    })
    const line = formatHelixdProfileStateAuthoritySelected(selectionWithRuntimeFields)
    expect(line).not.toContain('database_path')
  })

  it('never lets a failing sink block startup', () => {
    expect(() =>
      emitHelixdProfileStateAuthoritySelected(selection, () => {
        throw new Error('closed stderr')
      })
    ).not.toThrow()
  })
})
