import { describe, expect, it } from 'vitest'
import {
  encodeClaudeProjectPath,
  encodeClaudeProjectPaths,
  isClaudeProjectDirInScope
} from './claude-project-dir-encoding'

describe('encodeClaudeProjectPath', () => {
  it('emits one dash per non-alphanumeric character rather than per run', () => {
    expect(encodeClaudeProjectPath('/Users/ada/helix/workspaces')).toBe(
      '-Users-ada-helix-workspaces'
    )
    expect(encodeClaudeProjectPath('/Users/ada/.helix/worktrees')).toBe(
      '-Users-ada--helix-worktrees'
    )
  })

  it('encodes a Windows drive path', () => {
    expect(encodeClaudeProjectPath('C:\\Users\\ada\\helix\\workspaces')).toBe(
      'C--Users-ada-helix-workspaces'
    )
    expect(encodeClaudeProjectPath('C:\\')).toBe('C--')
  })

  it('encodes a WSL UNC path', () => {
    expect(encodeClaudeProjectPath('\\\\wsl$\\Ubuntu\\home\\ada\\helix\\workspaces')).toBe(
      '--wsl--Ubuntu-home-ada-helix-workspaces'
    )
  })

  it('drops trailing separators but keeps a bare root', () => {
    expect(encodeClaudeProjectPath('/Users/ada/helix/')).toBe('-Users-ada-helix')
    expect(encodeClaudeProjectPath('/')).toBe('-')
  })

  it('offers the NFC spelling alongside the raw one', () => {
    const nfd = '/Users/ada/cafe\u0301'
    expect(encodeClaudeProjectPaths(nfd)).toEqual([
      encodeClaudeProjectPath(nfd),
      encodeClaudeProjectPath(nfd.normalize('NFC'))
    ])
    expect(encodeClaudeProjectPaths('/Users/ada/cafe')).toEqual(['-Users-ada-cafe'])
  })
})

describe('isClaudeProjectDirInScope', () => {
  it('accepts the prefix itself and its dash-delimited descendants', () => {
    expect(isClaudeProjectDirInScope('-w-helix', ['-w-helix'])).toBe(true)
    expect(isClaudeProjectDirInScope('-w-helix-nautilus', ['-w-helix'])).toBe(true)
  })

  it('rejects a sibling that merely starts with the prefix', () => {
    expect(isClaudeProjectDirInScope('-w-helixdyne-nautilus', ['-w-helix'])).toBe(false)
  })
})
