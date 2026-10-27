import { browserSessionRegistry } from './browser-session-registry'
import type { BrowserSessionRegistryProfileOptions } from './browser-session-registry'
import { collectOrphanedBrowserRoutePartitionStorage } from './browser-route-partition-storage-runtime'
import { configureRouteSessionsForHelixProfile } from './browser-route-session-runtime'
import { configureBrowserSitePermissionStore } from './browser-site-permission-store'
import { configureBrowserSiteDisplayStore } from './browser-site-display-store'
import { configurePairedRuntimeBrowserClientHostsForHelixProfile } from './paired-runtime-browser-client-host-runtime'

let initialized = false

export function initializeBrowserSessionsForApp(
  activeProfile?: BrowserSessionRegistryProfileOptions & {
    listLocalSshTargetIds?: () => string[]
  }
): void {
  if (initialized) {
    return
  }

  if (activeProfile) {
    browserSessionRegistry.configureForHelixProfile(activeProfile)
    configureBrowserSitePermissionStore(activeProfile.profileDirectory)
    configureBrowserSiteDisplayStore(activeProfile.profileDirectory)
    configureRouteSessionsForHelixProfile({
      helixProfileId: activeProfile.helixProfileId,
      profileDirectory: activeProfile.profileDirectory
    })
    configurePairedRuntimeBrowserClientHostsForHelixProfile({
      helixProfileId: activeProfile.helixProfileId
    })
    void collectOrphanedBrowserRoutePartitionStorage(activeProfile.listLocalSshTargetIds).catch(
      (error) => {
        console.warn('[browser-route-partition] orphan collection failed:', error)
      }
    )
  }

  // Replay cookies before Chromium opens the live DB via session.fromPartition.
  browserSessionRegistry.applyPendingCookieImport()
  browserSessionRegistry.initializeBrowserSessionsFromPersistedState()
  initialized = true
}
