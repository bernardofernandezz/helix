import { describe, expect, it } from 'vitest'
import {
  formatCreateProjectParentSummary,
  getCreateProjectDefaultParentAutoFill,
  getDefaultCreateProjectParent,
  joinCreateProjectPath
} from './create-project-defaults'

describe('create project defaults', () => {
  it('builds the POSIX default project parent', () => {
    expect(getDefaultCreateProjectParent('/Users/alice')).toBe('/Users/alice/helix/projects')
  })

  it('builds the Windows default project parent', () => {
    expect(getDefaultCreateProjectParent('C:\\Users\\alice')).toBe(
      'C:\\Users\\alice\\helix\\projects'
    )
  })

  it('derives the runtime project default from a resolved server home', () => {
    expect(getDefaultCreateProjectParent('/home/alice')).toBe('/home/alice/helix/projects')
  })

  it('joins path previews without mixing separators', () => {
    expect(joinCreateProjectPath('/home/alice/helix/projects', 'demo')).toBe(
      '/home/alice/helix/projects/demo'
    )
    expect(joinCreateProjectPath('C:\\Users\\alice\\helix\\projects', 'demo')).toBe(
      'C:\\Users\\alice\\helix\\projects\\demo'
    )
  })

  it('auto-fills only the first empty local create step', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/helix/projects',
        createStepAutoFilled: false
      })
    ).toEqual({ parent: '/Users/alice/helix/projects' })
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '/tmp/project',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/helix/projects',
        createStepAutoFilled: false
      })
    ).toBeNull()
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/helix/projects',
        createStepAutoFilled: true
      })
    ).toBeNull()
  })

  it('does not apply a local default while a runtime environment is active', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: 'env-1',
        defaultParent: '/Users/alice/helix/projects',
        createStepAutoFilled: false
      })
    ).toBeNull()
  })

  it('uses a short local summary only for the local default parent', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/helix/projects',
        defaultParent: '/Users/alice/helix/projects'
      })
    ).toBe('~/helix/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '/home/alice/helix/projects',
        defaultParent: '/home/alice/helix/projects'
      })
    ).toBe('~/helix/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: 'C:\\Users\\alice\\helix\\projects',
        defaultParent: 'C:\\Users\\alice\\helix\\projects'
      })
    ).toBe('~/helix/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        runtimeEnvironmentId: 'env-1'
      })
    ).toBe('host folder not selected')
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/helix/projects',
        defaultParent: '/Users/alice/helix/projects',
        isRemoteHost: true
      })
    ).toBe('/Users/alice/helix/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        isRemoteHost: true
      })
    ).toBe('host folder not selected')
  })

  it('keeps a configured Workspace Directory verbatim in the summary', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: 'J:\\PROJECTS',
        defaultParent: 'J:\\PROJECTS'
      })
    ).toBe('J:\\PROJECTS')
    expect(
      formatCreateProjectParentSummary({
        parent: '/data/helix/projects',
        defaultParent: '/data/helix/projects'
      })
    ).toBe('/data/helix/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: 'D:\\code\\helix\\projects',
        defaultParent: 'D:\\code\\helix\\projects'
      })
    ).toBe('D:\\code\\helix\\projects')
  })
})
