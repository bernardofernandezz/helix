import { describe, it, expect } from 'vitest'
import { parseOsc7 } from './parse-osc7'

describe('parseOsc7', () => {
  it('extracts a plain POSIX path', () => {
    expect(parseOsc7('file://host/home/ana/repo')).toBe('/home/ana/repo')
  })

  it('accepts an empty host', () => {
    expect(parseOsc7('file:///home/ana')).toBe('/home/ana')
  })

  it('percent-decodes spaces', () => {
    expect(parseOsc7('file:///home/ana/my%20code')).toBe('/home/ana/my code')
  })

  it('strips the leading slash before a Windows drive letter', () => {
    expect(parseOsc7('file:///C:/Users/ana/repo')).toBe('C:/Users/ana/repo')
  })

  it('preserves Windows UNC cwd paths', () => {
    expect(parseOsc7('file://server/share/project', { uncHost: 'server' })).toBe(
      '\\\\server\\share\\project'
    )
  })

  it('does not treat unrelated OSC-7 hosts as UNC servers', () => {
    expect(parseOsc7('file://remote/home/ana/repo', { uncHost: 'server' })).toBe('/home/ana/repo')
  })

  it('keeps POSIX host-prefixed paths unchanged by default', () => {
    expect(parseOsc7('file://server/share/project')).toBe('/share/project')
  })

  it('returns null for non-file URIs', () => {
    expect(parseOsc7('http://example.com/')).toBeNull()
  })

  it('returns null for unterminated/malformed input', () => {
    expect(parseOsc7('not a uri')).toBeNull()
    expect(parseOsc7('file://host')).toBeNull()
  })

  it('returns null for invalid percent-encoding', () => {
    expect(parseOsc7('file:///bad%ZZ')).toBeNull()
  })
})
