import { ipcMain } from 'electron'
import type { HelixdManagedRuntimeStatus } from '../../../shared/helixd-managed-runtime'
import { createManagedHelixdEnvironment } from '../../managed-server/lifecycle/helixd-runtime-deployment'
import { getManagedHelixdRuntimeStatus } from '../../managed-server/lifecycle/helixd-runtime-status'

export function registerHelixdRuntimeLifecycleHandlers(options: {
  getUserDataPath: () => string
}): void {
  ipcMain.handle(
    'runtimeEnvironments:deployHelixd',
    async (_event, args: { name: string; sshTargetId: string; force?: boolean }) =>
      createManagedHelixdEnvironment(options.getUserDataPath(), {
        name: requiredString(args?.name, 'Server name'),
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        force: args?.force === true
      })
  )
  ipcMain.handle(
    'runtimeEnvironments:getHelixdStatus',
    (_event, args: { selector: string }): Promise<HelixdManagedRuntimeStatus> =>
      getManagedHelixdRuntimeStatus(
        options.getUserDataPath(),
        requiredString(args?.selector, 'Server')
      )
  )
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}
