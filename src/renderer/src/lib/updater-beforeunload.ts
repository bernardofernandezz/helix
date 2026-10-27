import {
  HELIX_APP_RESTART_ABORTED_EVENT,
  HELIX_APP_RESTART_STARTED_EVENT,
  HELIX_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  HELIX_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../../../shared/updater-renderer-events'
import { HELIX_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT } from '../../../shared/renderer-shutdown-events'

let intentionalAppRestartInProgress = false

export function isUpdaterQuitAndInstallInProgress(): boolean {
  return isIntentionalAppRestartInProgress()
}

export function isIntentionalAppRestartInProgress(): boolean {
  return intentionalAppRestartInProgress
}

export function registerUpdaterBeforeUnloadBypass(): () => void {
  const markInProgress = (): void => {
    intentionalAppRestartInProgress = true
  }
  const clearInProgress = (): void => {
    intentionalAppRestartInProgress = false
  }

  window.addEventListener(HELIX_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
  window.addEventListener(HELIX_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
  window.addEventListener(HELIX_APP_RESTART_STARTED_EVENT, markInProgress)
  window.addEventListener(HELIX_APP_RESTART_ABORTED_EVENT, clearInProgress)
  window.addEventListener(HELIX_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)

  return () => {
    window.removeEventListener(HELIX_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
    window.removeEventListener(HELIX_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(HELIX_APP_RESTART_STARTED_EVENT, markInProgress)
    window.removeEventListener(HELIX_APP_RESTART_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(HELIX_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)
    // HMR can re-register listeners; cleanup must reset the flag so failed restarts cannot suppress later unsaved-change prompts.
    intentionalAppRestartInProgress = false
  }
}
