import { join } from 'node:path'

// Install roots that conda, mamba and micromamba installers create in the home directory.
const HOME_INSTALL_DIRS = [
  'miniconda3',
  'miniforge3',
  'mambaforge',
  'anaconda3',
  'micromamba',
  'miniconda',
  'anaconda',
  '.conda',
  '.local/share/mamba'
]
const SYSTEM_INSTALL_DIRS = ['/opt/conda', '/opt/miniconda3', '/opt/miniforge3', '/opt/anaconda3']

export type CondaDiscoveryHost = {
  home: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  exists: (path: string) => boolean
  readText: (path: string) => string | undefined
  listDirs: (path: string) => string[]
}

export function condaInterpreter(envDir: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? join(envDir, 'python.exe') : join(envDir, 'bin', 'python')
}

function parentOfBin(executable: string): string {
  return join(executable, '..', '..')
}

/** Conda environment directories on this machine that contain a Python interpreter. */
export function findCondaEnvironmentDirs(host: CondaDiscoveryHost): string[] {
  const roots = [
    ...HOME_INSTALL_DIRS.map((dir) => join(host.home, ...dir.split('/'))),
    ...(host.platform === 'win32' ? [] : SYSTEM_INSTALL_DIRS),
    ...[host.env.CONDA_EXE, host.env.MAMBA_EXE].flatMap((exe) => (exe ? [parentOfBin(exe)] : [])),
    ...(host.env.MAMBA_ROOT_PREFIX ? [host.env.MAMBA_ROOT_PREFIX] : [])
  ]
  const candidates = [
    // conda records every environment it creates or activates here, including custom prefixes.
    ...(host.readText(join(host.home, '.conda', 'environments.txt')) ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    ...roots.flatMap((root) => [
      root,
      ...host.listDirs(join(root, 'envs')).map((name) => join(root, 'envs', name))
    ]),
    ...(host.env.CONDA_PREFIX ? [host.env.CONDA_PREFIX] : [])
  ]
  const seen = new Set<string>()
  return candidates.filter((dir) => {
    if (seen.has(dir)) {
      return false
    }
    seen.add(dir)
    return host.exists(join(dir, 'conda-meta')) && host.exists(condaInterpreter(dir, host.platform))
  })
}

/** The `name:` an `environment.yml` declares, which is the conda env the project expects. */
export function environmentFileName(text: string | undefined): string | null {
  const match = text && /^name:\s*["']?([^\s"'#]+)/m.exec(text)
  return match ? (match[1] ?? null) : null
}

export function condaEnvironmentName(envDir: string, isBase: boolean): string {
  const name = envDir.split(/[\\/]/).findLast(Boolean) ?? envDir
  return isBase ? `base (${name})` : name
}
