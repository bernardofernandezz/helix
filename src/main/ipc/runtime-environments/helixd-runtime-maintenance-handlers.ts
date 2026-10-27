import { ipcMain } from 'electron'
import { registerManagedServerActions } from '../../runtime/managed-server-actions-registry'
import {
  createManagedHelixdActions,
  reclaimManagedHelixdStaleLock,
  restartManagedHelixd,
  type ManagedHelixdActionOptions
} from './managed-helixd-actions'
import { requiredString } from './helixd-runtime-lifecycle-handlers'

export function registerHelixdRuntimeMaintenanceHandlers(
  options: ManagedHelixdActionOptions
): void {
  const actions = createManagedHelixdActions(options)
  // CLI runtime RPC uses these same managedServer actions.
  registerManagedServerActions(actions)
  ipcMain.handle(
    'runtimeEnvironments:updateHelixd',
    async (
      _event,
      args: {
        selector: string
        force?: boolean
        pastLiveTerminals?: { incumbentVersion?: unknown }
      }
    ) => {
      const incumbentVersion = args?.pastLiveTerminals?.incumbentVersion
      const pastLiveTerminals =
        args?.pastLiveTerminals &&
        (typeof incumbentVersion === 'string' || incumbentVersion === null)
          ? { incumbentVersion }
          : undefined
      return actions.update(
        requiredString(args?.selector, 'Server'),
        args?.force === true,
        pastLiveTerminals
      )
    }
  )
  ipcMain.handle('runtimeEnvironments:rollbackHelixd', async (_event, args: { selector: string }) =>
    actions.rollback(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:recoverHelixd',
    async (_event, args: { selector: string; acceptChangedState?: boolean }) =>
      actions.recover(requiredString(args?.selector, 'Server'), args?.acceptChangedState === true)
  )
  ipcMain.handle('runtimeEnvironments:restartHelixd', async (_event, args: { selector: string }) =>
    restartManagedHelixd(options, requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:reclaimHelixdStaleLock',
    async (_event, args: { selector: string; yes?: boolean; expectNonce?: string }) =>
      reclaimManagedHelixdStaleLock(
        options,
        requiredString(args?.selector, 'Server'),
        // A confirmation without the checked record's nonce could clear a lock written since.
        args?.yes === true
          ? { yes: true, expectNonce: requiredString(args.expectNonce, 'The checked lock') }
          : { yes: false }
      )
  )
  ipcMain.handle('runtimeEnvironments:stopHelixd', async (_event, args: { selector: string }) =>
    actions.stop(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:cancelHelixdStop',
    async (_event, args: { selector: string }) =>
      actions.cancelStop(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle('runtimeEnvironments:forgetHelixd', async (_event, args: { selector: string }) =>
    actions.forget(requiredString(args?.selector, 'Server'))
  )
}
