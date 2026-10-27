import { describe, expect, it } from 'vitest'
import { parseHelixBrowserCommand } from './helix-browser-cli-commands'

describe('parseHelixBrowserCommand', () => {
  it.each([
    ['helix click --element e3', null],
    ['helix snapshot --page p1', 'p1'],
    ['helix-dev fill --element e2 --text hi --page=p2', 'p2'],
    ["helix goto --url https://example.com --page='p3'", 'p3'],
    ['/Users/me/.local/bin/helix screenshot', null],
    ['C:\\Users\\me\\helix\\helix.cmd tab create', null],
    ['helix-ide mouse move --x 1 --y 2', null],
    ['cd app && helix click --element e3 --page p4', 'p4'],
    ['git status; HELIX_DEBUG=1 helix tab list', null],
    ['helix snapshot | head -20', null],
    ['helix browser identity get', null]
  ])('matches %s', (command, pageId) => {
    expect(parseHelixBrowserCommand(command)).toEqual({ pageId })
  })

  it.each([
    'helix worktree ls',
    'helix terminal send --text "helix click"',
    'helixstra click',
    'helix',
    'echo helix click',
    'echo "docs; helix snapshot --page p1; text"',
    "git commit -m 'run helix click | helix snapshot'",
    'git log --oneline'
  ])('does not match %s', (command) => {
    expect(parseHelixBrowserCommand(command)).toBeNull()
  })
})
