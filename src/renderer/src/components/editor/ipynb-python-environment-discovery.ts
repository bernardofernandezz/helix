import {
  recommendedPythonEnvironment,
  type PythonEnvironment
} from '../../../../shared/notebook-kernel-types'

/** Lists this notebook's Python environments and returns the one a new kernel should use. */
export async function findRecommendedPythonEnvironment(
  filePath: string,
  rootPath: string | null
): Promise<PythonEnvironment | undefined> {
  const found = await window.api.notebook.listPythonEnvironments({
    filePath,
    rootPath,
    runWorkspaceInterpreters: true
  })
  return recommendedPythonEnvironment(found)
}
