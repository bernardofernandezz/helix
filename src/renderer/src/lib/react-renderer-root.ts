import { createRoot, type Root } from 'react-dom/client'

type RendererRootHotData = {
  helixRendererRoot?: Root
}

export function getOrCreateRendererRoot(
  container: HTMLElement,
  hotData?: RendererRootHotData
): Root {
  const existingRoot = hotData?.helixRendererRoot
  if (existingRoot) {
    return existingRoot
  }
  const root = createRoot(container)
  if (hotData) {
    hotData.helixRendererRoot = root
  }
  return root
}
