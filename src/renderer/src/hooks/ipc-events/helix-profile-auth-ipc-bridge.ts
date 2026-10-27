import { useAppStore } from '../../store'

export function registerHelixProfileAuthIpcBridge(unsubs: (() => void)[]): void {
  const api = window.api.helixProfiles
  if (typeof api?.onAuthStatusChanged === 'function') {
    unsubs.push(
      api.onAuthStatusChanged(() => {
        void useAppStore.getState().fetchHelixProfileAuthStatus()
      })
    )
  }
  if (typeof api?.onSignInProgressChanged === 'function') {
    // Why: a sign-in can already be in flight when this window loads; a later event or teardown wins.
    let ignoreSnapshot = false
    const unsubscribe = api.onSignInProgressChanged((progress) => {
      ignoreSnapshot = true
      useAppStore.setState({ helixProfileSignInProgress: progress })
    })
    unsubs.push(() => {
      ignoreSnapshot = true
      unsubscribe()
    })
    void Promise.resolve()
      .then(() => api.signInProgress())
      .then((progress) => {
        if (!ignoreSnapshot) {
          useAppStore.setState({ helixProfileSignInProgress: progress ?? null })
        }
      })
      .catch(() => {})
  }
}
