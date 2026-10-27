/** A Python interpreter that can host a notebook kernel. */
export type PythonEnvironment = {
  /** Absolute interpreter path; the kernel runs in this interpreter's environment. */
  path: string
  /** `.venv`, `python3`, … — what the kernel picker shows first. */
  name: string
  /** Absent for a workspace env listed before trust, which is read from disk rather than run. */
  version?: string
}

export type PythonEnvironments = {
  /** `.venv`/`.conda` envs around the notebook, nearest first; the first is recommended. */
  workspace: PythonEnvironment[]
  /** Named conda/mamba environments on this machine; the one the project's environment.yml names comes first. */
  conda: PythonEnvironment[]
  /** True when `conda[0]` is the environment named by the project's environment.yml. */
  condaMatchesProject: boolean
  /** Interpreters found on PATH. */
  path: PythonEnvironment[]
}

/** A workspace env, else the conda env the project's environment.yml names, else Python on PATH. */
export function recommendedPythonEnvironment(
  found: PythonEnvironments
): PythonEnvironment | undefined {
  return (
    found.workspace[0] ?? (found.condaMatchesProject ? found.conda[0] : undefined) ?? found.path[0]
  )
}

export type KernelStartResult =
  | { status: 'ready' }
  /** `externallyManaged`: pip refuses to install into it (PEP 668), so it needs a virtual environment. */
  | { status: 'missing-ipykernel'; externallyManaged: boolean }
  | { status: 'failed'; detail: string }

/** Kernel output message types the bridge forwards, named as in the Jupyter messaging protocol. */
export const KERNEL_OUTPUT_TYPES = [
  'stream',
  'display_data',
  'execute_result',
  'update_display_data',
  'clear_output',
  'error'
] as const
export type KernelOutputType = (typeof KERNEL_OUTPUT_TYPES)[number]

/** What a running kernel reports, in order, for the one execution in flight. */
export type KernelFrame =
  | { type: KernelOutputType; content: Record<string, unknown> }
  | { type: 'done'; status: string; execution_count: number | null }
  /** The kernel is gone; `detail` is the tail of its stderr. */
  | { type: 'exit'; detail: string }

export type CreateVenvResult =
  | { ok: true; environment: PythonEnvironment }
  | { ok: false; detail: string }

export type KernelFrameEvent = { filePath: string; frame: KernelFrame }
