import { describe, expect, it } from 'vitest'
import {
  formatHelixSessionAddress,
  isHelixSessionId,
  parseHelixSessionAddress
} from './helix-session-address'
import { testHelixSessionId } from './helix-session-address-test-fixture'

const SESSION_ID = testHelixSessionId('0b7e4c2a-5f1d-4e8a-9c3b-2d6f8a1e4b70')
const ADDRESS = `helix_session_id:${SESSION_ID}`

describe('Helix session address', () => {
  it('addresses an Helix session id as helix_session_id:<id> and parses the bare id back', () => {
    expect(formatHelixSessionAddress(SESSION_ID)).toBe(ADDRESS)
    expect(parseHelixSessionAddress(ADDRESS)).toBe(SESSION_ID)
    const parsed = parseHelixSessionAddress(ADDRESS)
    expect(parsed && formatHelixSessionAddress(parsed)).toBe(ADDRESS)
  })

  it('reads only the addressed spelling when parsing an address', () => {
    // A bare id is what the columns store, not an address.
    expect(parseHelixSessionAddress(SESSION_ID)).toBeNull()
    expect(parseHelixSessionAddress(null)).toBeNull()
    expect(parseHelixSessionAddress(undefined)).toBeNull()
    expect(parseHelixSessionAddress('')).toBeNull()
  })

  it.each([
    ['an unknown prefix', `pane:${SESSION_ID}`],
    ['the Run mailbox namespace', 'run:run_123'],
    ['the Dispatch mailbox namespace', 'dispatch:ctx_123'],
    ['an empty prefix', `:${SESSION_ID}`],
    ['an empty id', 'helix_session_id:'],
    ['an id with a separator', `helix_session_id:${SESSION_ID}:extra`],
    ['an id the session predicate rejects', 'helix_session_id:short'],
    ['a terminal handle', 'term_4f2c9a']
  ])('refuses %s', (_label, value) => {
    expect(parseHelixSessionAddress(value)).toBeNull()
  })

  it('no longer reads the retired session:<id> spelling as a session, as an address or a bare id', () => {
    expect(parseHelixSessionAddress(`session:${SESSION_ID}`)).toBeNull()
    expect(isHelixSessionId(`session:${SESSION_ID}`)).toBe(false)
  })

  it.each([
    ['a PTY terminal handle', 'term_4f2c9a1b-7d3e-4a5f-8b6c-9d0e1f2a3b4c'],
    ['a short PTY terminal handle', 'term_4f2c9a'],
    ['a structured-worker handle', 'structworker_4f2c9a1b-7d3e-4a5f-8b6c-9d0e1f2a3b4c']
  ])('never treats %s as an Helix session id', (_label, handle) => {
    // Handles share the session-id charset, so the session-record predicate alone would accept them.
    expect(isHelixSessionId(handle)).toBe(false)
    expect(parseHelixSessionAddress(`helix_session_id:${handle}`)).toBeNull()
  })

  it('validates an Helix session id with the session-record predicate', () => {
    expect(isHelixSessionId(SESSION_ID)).toBe(true)
    expect(isHelixSessionId('has space in it')).toBe(false)
    expect(isHelixSessionId('x'.repeat(129))).toBe(false)
  })
})
