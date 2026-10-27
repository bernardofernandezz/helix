import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const researchToolsApi = {
  setUpProject: (args) => ipcRenderer.invoke('researchTools:setUpProject', args)
} satisfies PreloadApi['researchTools']
