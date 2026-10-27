import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  condaEnvironmentName,
  environmentFileName,
  findCondaEnvironmentDirs,
  type CondaDiscoveryHost
} from './conda-environments'

const HOME = join('/home', 'ana')

function host(files: string[], overrides: Partial<CondaDiscoveryHost> = {}): CondaDiscoveryHost {
  const all = new Set(files)
  return {
    home: HOME,
    platform: 'linux',
    env: {},
    exists: (path) => all.has(path) || files.some((file) => file.startsWith(`${path}/`)),
    readText: () => undefined,
    listDirs: (path) => [
      ...new Set(
        files
          .filter((file) => file.startsWith(`${path}/`))
          .map((file) => file.slice(path.length + 1).split('/')[0] ?? '')
      )
    ],
    ...overrides
  }
}

function env(dir: string): string[] {
  return [join(dir, 'conda-meta', 'history'), join(dir, 'bin', 'python')]
}

describe('findCondaEnvironmentDirs', () => {
  it('finds the base install and its named environments', () => {
    const base = join(HOME, 'miniforge3')
    const dirs = findCondaEnvironmentDirs(
      host([
        ...env(base),
        ...env(join(base, 'envs', 'rnaseq')),
        ...env(join(base, 'envs', 'scanpy'))
      ])
    )
    expect(dirs).toEqual([base, join(base, 'envs', 'rnaseq'), join(base, 'envs', 'scanpy')])
  })

  it('reads custom prefixes from environments.txt and skips dirs without Python', () => {
    const custom = '/data/envs/variant-calling'
    const noPython = '/data/envs/r-only'
    const dirs = findCondaEnvironmentDirs(
      host([...env(custom), join(noPython, 'conda-meta', 'history')], {
        readText: (path) =>
          path === join(HOME, '.conda', 'environments.txt') ? `${custom}\n${noPython}\n` : undefined
      })
    )
    expect(dirs).toEqual([custom])
  })

  it('uses CONDA_EXE and MAMBA_ROOT_PREFIX for installs outside the usual places', () => {
    const scratch = '/scratch/conda'
    const mamba = '/srv/mamba'
    const dirs = findCondaEnvironmentDirs(
      host([...env(scratch), ...env(join(mamba, 'envs', 'qc'))], {
        env: { CONDA_EXE: join(scratch, 'bin', 'conda'), MAMBA_ROOT_PREFIX: mamba }
      })
    )
    expect(dirs).toEqual([scratch, join(mamba, 'envs', 'qc')])
  })

  it('looks for python.exe at the environment root on Windows', () => {
    const base = join(HOME, 'miniconda3')
    const dirs = findCondaEnvironmentDirs(
      host([join(base, 'conda-meta', 'history'), join(base, 'python.exe')], { platform: 'win32' })
    )
    expect(dirs).toEqual([base])
  })
})

describe('environment names', () => {
  it('reads the env name from environment.yml', () => {
    expect(environmentFileName('name: rnaseq\nchannels:\n  - bioconda\n')).toBe('rnaseq')
    expect(environmentFileName('channels: [bioconda]\nname: "scanpy-env" # lab env\n')).toBe(
      'scanpy-env'
    )
    expect(environmentFileName('dependencies:\n  - python=3.12\n')).toBeNull()
    expect(environmentFileName(undefined)).toBeNull()
  })

  it('labels base installs', () => {
    expect(condaEnvironmentName('/home/ana/miniforge3', true)).toBe('base (miniforge3)')
    expect(condaEnvironmentName('/home/ana/miniforge3/envs/rnaseq', false)).toBe('rnaseq')
  })
})
