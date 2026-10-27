type HelixCloudSessionInvalidationListener = () => void

const listeners = new Set<HelixCloudSessionInvalidationListener>()

/** Auth-failure invalidation only; explicit sign-out returns fresh status directly. */
export function onHelixCloudSessionInvalidated(
  listener: HelixCloudSessionInvalidationListener
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitHelixCloudSessionInvalidated(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn(
        '[helix-profiles] Cloud session invalidation listener failed:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
