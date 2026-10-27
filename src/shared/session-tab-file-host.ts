import type { RuntimeMobileSessionFileTab } from './runtime-mobile-session-tab-contracts'

/** Names the paired server a row's file lives on, for runtimes to keep from other runtimes. */
export function editorRowHost(file: {
  runtimeEnvironmentId?: string | null
}): Pick<RuntimeMobileSessionFileTab, 'hostRuntimeEnvironmentId'> {
  const hostRuntimeEnvironmentId = file.runtimeEnvironmentId?.trim()
  return hostRuntimeEnvironmentId ? { hostRuntimeEnvironmentId } : {}
}
