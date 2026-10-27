import { ipcMain } from 'electron'
import type {
  HelixdManagedConversionResult,
  HelixdManagedPendingMigrationRow
} from '../../../shared/helixd-managed-runtime'
import { listPendingManagedHelixdMigrations } from '../../managed-server/lifecycle/helixd-managed-migration-status'
import { convertSshTargetToManagedHelixd } from '../../managed-server/lifecycle/helixd-runtime-conversion'
import { conversionCollaborators } from '../../managed-server/lifecycle/helixd-runtime-conversion-wiring'
import { requiredString } from './helixd-runtime-lifecycle-handlers'

export function registerHelixdRuntimeConversionHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:convertSshHostToManagedHelixd',
    (
      _event,
      args: { sshTargetId: string; name: string }
    ): Promise<HelixdManagedConversionResult> => {
      return convertSshTargetToManagedHelixd(getUserDataPath(), {
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        name: requiredString(args?.name, 'Server name'),
        ...conversionCollaborators()
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:listPendingHelixdMigrations',
    (): HelixdManagedPendingMigrationRow[] => listPendingManagedHelixdMigrations(getUserDataPath())
  )
}
