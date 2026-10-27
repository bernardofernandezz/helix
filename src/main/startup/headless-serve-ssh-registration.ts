import type { Store } from '../persistence'
import type { HelixRuntimeService } from '../runtime/helix-runtime'
import { registerSshHandlers } from '../ipc/ssh/ssh'
import { mainProcessState as state } from './main-process-state'

/** Register SSH before any window so headless serve can list/connect targets; later window registration is idempotent. */
export function registerHeadlessServeSshHandlers(store: Store, runtime: HelixRuntimeService): void {
  registerSshHandlers(store, () => state.mainWindow ?? null, runtime)
}
