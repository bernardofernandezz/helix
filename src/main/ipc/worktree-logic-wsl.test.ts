import { win32 } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getWslHomeMock, getWslHomeAsyncMock, parseWslPathMock } = vi.hoisted(() => ({
  getWslHomeMock: vi.fn(),
  getWslHomeAsyncMock: vi.fn(),
  parseWslPathMock: vi.fn()
}))

vi.mock('../wsl', () => ({
  getWslHome: getWslHomeMock,
  getWslHomeAsync: getWslHomeAsyncMock,
  parseWslPath: parseWslPathMock
}))

import {
  computeWorktreePath,
  computeWorktreePathAsync,
  computeWorkspaceRootAsync,
  computeWorkspaceRootWithin,
  getWorktreePathSettings
} from './worktree-logic'
import {
  buildKnownHelixWorkspaceLayouts,
  classifyWorktreeOwnership
} from '../../shared/worktree/ownership'
import { relativePathInsideRoot } from '../../shared/cross-platform-path'
import type { Repo } from '../../shared/repo-types'

describe('computeWorktreePath WSL layout', () => {
  beforeEach(() => {
    getWslHomeMock.mockReset()
    getWslHomeAsyncMock.mockReset()
    parseWslPathMock.mockReset()
  })

  it('reuses an asynchronously resolved root for every name candidate without a sync probe', async () => {
    parseWslPathMock.mockReturnValue({ distro: 'Ubuntu', linuxPath: '/home/ana/repo' })
    const repoPath = String.raw`\\wsl.localhost\Ubuntu\home\ana\repo`
    const home = String.raw`\\wsl.localhost\Ubuntu\home\ana`
    const settings = { workspaceDir: 'C:\\workspaces', nestWorkspaces: true }
    let resolveHome!: (home: string) => void
    getWslHomeAsyncMock.mockReturnValue(new Promise<string>((resolve) => (resolveHome = resolve)))
    const pendingRoot = computeWorkspaceRootAsync(repoPath, settings)
    expect(getWslHomeMock).not.toHaveBeenCalled()
    resolveHome(home)
    const root = await pendingRoot
    for (const name of ['feature', 'feature-2', 'feature-3']) {
      expect(computeWorktreePath(name, repoPath, settings, root)).toBe(
        win32.join(home, 'helix', 'workspaces', 'repo', name)
      )
    }
    expect(getWslHomeAsyncMock).toHaveBeenCalledExactlyOnceWith('Ubuntu')
    expect(getWslHomeMock).not.toHaveBeenCalled()
  })

  it('stops waiting for a WSL home at the deadline and falls back, leaving the probe running', async () => {
    vi.useFakeTimers()
    try {
      parseWslPathMock.mockReturnValue({ distro: 'Ubuntu', linuxPath: '/home/ana/repo' })
      const repoPath = String.raw`\\wsl.localhost\Ubuntu\home\ana\repo`
      const settings = { workspaceDir: 'C:\\workspaces', nestWorkspaces: true }
      getWslHomeAsyncMock.mockReturnValue(new Promise<string>(() => {}))
      const pending = computeWorkspaceRootWithin(repoPath, settings, 5_000)
      await vi.advanceTimersByTimeAsync(5_000)
      const fallback = await pending
      expect(fallback).not.toContain('helix')
      expect(getWslHomeMock).not.toHaveBeenCalled()

      getWslHomeAsyncMock.mockResolvedValue(String.raw`\\wsl.localhost\Ubuntu\home\ana`)
      expect(await computeWorkspaceRootWithin(repoPath, settings, 5_000)).toBe(
        win32.join(String.raw`\\wsl.localhost\Ubuntu\home\ana`, 'helix', 'workspaces')
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('places WSL repo worktrees under the distro home workspace root', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')

    expect(
      computeWorktreePath('feature', '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo', {
        nestWorkspaces: true,
        workspaceDir: 'C:\\workspaces'
      })
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\ana\\helix\\workspaces\\repo\\feature')
  })

  it('falls back to the configured Windows workspace when WSL home lookup fails', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue(null)

    expect(
      computeWorktreePath('feature', '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo', {
        nestWorkspaces: false,
        workspaceDir: 'C:\\workspaces'
      })
    ).toBe(win32.join('C:\\workspaces', 'feature'))
  })

  it('honors an absolute Linux repo worktree base path inside the repo distro (BIO-4772)', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')
    const repo = {
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo',
      worktreeBasePath: '/home/ana/src/.helix-worktrees'
    }
    const settings = { nestWorkspaces: false, workspaceDir: 'C:\\workspaces' }

    expect(computeWorktreePath('feature', repo.path, getWorktreePathSettings(repo, settings))).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\.helix-worktrees\\feature'
    )
    expect(computeWorktreePath('feature', repo.path, getWorktreePathSettings(repo, settings))).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\.helix-worktrees\\feature'
    )
    expect(getWslHomeMock).not.toHaveBeenCalled()
  })

  it('honors a drvfs /mnt repo base path instead of mirroring it away', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')
    const repo = {
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo',
      worktreeBasePath: '/mnt/d/trees'
    }

    expect(
      computeWorktreePath(
        'feature',
        repo.path,
        getWorktreePathSettings(repo, { nestWorkspaces: false, workspaceDir: 'C:\\workspaces' })
      )
    ).toBe('\\\\wsl.localhost\\Ubuntu\\mnt\\d\\trees\\feature')
  })

  it('collapses dotted Linux repo base paths end to end', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')
    const repo = {
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo',
      worktreeBasePath: '/home/ana/src/../trees'
    }

    expect(
      computeWorktreePath(
        'feature',
        repo.path,
        getWorktreePathSettings(repo, { nestWorkspaces: false, workspaceDir: 'C:\\workspaces' })
      )
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\ana\\trees\\feature')
  })

  it('still mirrors drive-letter repo base paths into the distro home', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')
    const repo = {
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo',
      worktreeBasePath: 'D:\\trees'
    }

    expect(
      computeWorktreePath(
        'feature',
        repo.path,
        getWorktreePathSettings(repo, { nestWorkspaces: false, workspaceDir: 'C:\\workspaces' })
      )
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\ana\\helix\\workspaces\\feature')
  })

  it('classifies whatever creation produces for Linux bases, dotted or not', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')
    const settings = { nestWorkspaces: true, workspaceDir: 'C:\\workspaces' }
    for (const worktreeBasePath of ['/home/ana/trees', '/home/ana/src/../trees', '/mnt/d/trees']) {
      const repo = {
        id: 'r1',
        path: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo',
        displayName: 'repo',
        badgeColor: '#000',
        addedAt: 0,
        kind: 'git',
        worktreeBasePath
      } as Repo
      // Create and allowed-root resolvers must agree on placement.
      const createdPath = computeWorktreePath(
        'feature',
        repo.path,
        getWorktreePathSettings(repo, settings)
      )
      const layouts = buildKnownHelixWorkspaceLayouts(
        { ...settings, workspaceDirHistory: [] },
        repo
      )
      // Ownership alone also accepts mirror layout; require containment in the selected repo-base layout.
      expect(relativePathInsideRoot(layouts[0].path, createdPath)).not.toBeNull()
      expect(
        classifyWorktreeOwnership({
          repo,
          settings: { ...settings, workspaceDirHistory: [] },
          worktree: { path: createdPath, isMainWorktree: false },
          knownHelixLayouts: layouts
        })
      ).toBe('external')
    }
  })

  it('resolves the Linux repo base path identically through the async twin', async () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')
    getWslHomeAsyncMock.mockResolvedValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')
    const repo = {
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo',
      worktreeBasePath: '/home/ana/src/.helix-worktrees'
    }
    const pathSettings = getWorktreePathSettings(repo, {
      nestWorkspaces: false,
      workspaceDir: 'C:\\workspaces'
    })

    await expect(computeWorktreePathAsync('feature', repo.path, pathSettings)).resolves.toBe(
      computeWorktreePath('feature', repo.path, pathSettings)
    )
  })

  it('honors a Linux repo base path even when the distro home lookup fails', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue(null)
    const repo = {
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo',
      worktreeBasePath: '/home/ana/trees'
    }

    expect(
      computeWorktreePath(
        'feature',
        repo.path,
        getWorktreePathSettings(repo, { nestWorkspaces: false, workspaceDir: 'C:\\workspaces' })
      )
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\ana\\trees\\feature')
  })

  it('keeps relative repo base paths anchored to the WSL repo', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')
    const repo = {
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo',
      worktreeBasePath: '../worktrees'
    }

    expect(
      computeWorktreePath(
        'feature',
        repo.path,
        getWorktreePathSettings(repo, { nestWorkspaces: false, workspaceDir: 'C:\\workspaces' })
      )
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\worktrees\\feature')
  })

  it('uses an explicit WSL UNC workspace root without remapping it', () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu',
      linuxPath: '/home/ana/src/repo'
    })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')

    expect(
      computeWorktreePath('feature', '\\\\wsl.localhost\\Ubuntu\\home\\ana\\src\\repo', {
        nestWorkspaces: false,
        workspaceDir: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\custom-worktrees'
      })
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\ana\\custom-worktrees\\feature')
  })

  // WSL Git stats Windows-drive worktrees through slow 9p; keep the tree on Linux and only Git metadata on Windows.
  describe('Windows-drive repo whose project runs in WSL', () => {
    it('places worktrees inside the distro', () => {
      parseWslPathMock.mockReturnValue(null)
      getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')

      expect(
        computeWorktreePath('feature', 'C:\\Users\\ana\\repo', {
          nestWorkspaces: false,
          workspaceDir: 'C:\\workspaces',
          wslMirrorDistro: 'Ubuntu'
        })
      ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\ana\\helix\\workspaces\\feature')
    })

    it('keeps Windows placement when the project has no WSL runtime', () => {
      parseWslPathMock.mockReturnValue(null)

      expect(
        computeWorktreePath('feature', 'C:\\Users\\ana\\repo', {
          nestWorkspaces: false,
          workspaceDir: 'C:\\workspaces'
        })
      ).toBe(win32.join('C:\\workspaces', 'feature'))
      expect(getWslHomeMock).not.toHaveBeenCalled()
    })

    it('falls back to Windows placement when the distro home cannot be resolved', () => {
      parseWslPathMock.mockReturnValue(null)
      getWslHomeMock.mockReturnValue(null)

      expect(
        computeWorktreePath('feature', 'C:\\Users\\ana\\repo', {
          nestWorkspaces: false,
          workspaceDir: 'C:\\workspaces',
          wslMirrorDistro: 'Ubuntu'
        })
      ).toBe(win32.join('C:\\workspaces', 'feature'))
    })

    it('respects an explicit repo-relative workspace dir', () => {
      parseWslPathMock.mockReturnValue(null)

      expect(
        computeWorktreePath('feature', 'C:\\Users\\ana\\repo', {
          nestWorkspaces: false,
          workspaceDir: 'worktrees',
          wslMirrorDistro: 'Ubuntu'
        })
      ).toBe(win32.join('C:\\Users\\ana\\repo', 'worktrees', 'feature'))
      expect(getWslHomeMock).not.toHaveBeenCalled()
    })

    it('ignores a stray mirror distro on a POSIX repo path', () => {
      parseWslPathMock.mockReturnValue(null)

      expect(
        computeWorktreePath('feature', '/Users/ana/repo', {
          nestWorkspaces: false,
          workspaceDir: '/Users/ana/workspaces',
          wslMirrorDistro: 'Ubuntu'
        })
      ).toBe('/Users/ana/workspaces/feature')
      expect(getWslHomeMock).not.toHaveBeenCalled()
    })

    it('mirrors on the async path too', async () => {
      parseWslPathMock.mockReturnValue(null)
      getWslHomeAsyncMock.mockResolvedValue('\\\\wsl.localhost\\Ubuntu\\home\\ana')

      await expect(
        computeWorktreePathAsync('feature', 'C:\\Users\\ana\\repo', {
          nestWorkspaces: false,
          workspaceDir: 'C:\\workspaces',
          wslMirrorDistro: 'Ubuntu'
        })
      ).resolves.toBe('\\\\wsl.localhost\\Ubuntu\\home\\ana\\helix\\workspaces\\feature')
    })
  })
})
