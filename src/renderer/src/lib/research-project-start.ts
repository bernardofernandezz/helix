import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { defaultCreationHost } from '@/lib/default-creation-host'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store'

/** Pick a folder, lay it out as a research project with the research tools, then open it. */
export async function startResearchProject(): Promise<void> {
  const store = useAppStore.getState()
  // Why: the OS picker returns client-local paths and the research scaffold writes locally.
  if (defaultCreationHost(store.settings).kind !== 'local') {
    store.openModal('add-repo')
    return
  }
  try {
    const path = await window.api.repos.pickFolder()
    if (!path) {
      return
    }
    const result = await window.api.researchTools.setUpProject({ projectPath: path })
    if (!result.ok) {
      toast.error(translate('helix.researchProject.setupFailed', 'Research tools were not added'), {
        description: result.detail
      })
    }
    // A failed scaffold still leaves a usable folder project; the toast says what is missing.
    await useAppStore.getState().addNonGitFolder(path)
  } catch (error) {
    toast.error(extractIpcErrorMessage(error, 'Failed to start the research project.'))
  }
}
