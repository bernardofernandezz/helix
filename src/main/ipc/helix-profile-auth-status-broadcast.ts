import { BrowserWindow } from 'electron'
import {
  HELIX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  HELIX_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type HelixCloudSignInProgress
} from '../../shared/helix-profiles'

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(channel, ...args)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}

export function broadcastHelixProfileAuthStatusChanged(): void {
  broadcast(HELIX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL)
}

export function broadcastHelixProfileSignInProgressChanged(
  progress: HelixCloudSignInProgress | null
): void {
  broadcast(HELIX_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, progress)
}
