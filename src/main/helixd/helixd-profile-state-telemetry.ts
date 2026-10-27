import type { ProfileStateStorageClassification } from '../persistence/profile-state/profile-state-storage-classification'

/** Exclude paths, profile IDs and serialized state from fleet telemetry. */
export type HelixdProfileStateAuthoritySelection = {
  backend: 'sqlite'
  classification: ProfileStateStorageClassification
  authority_mode: 'sqlite-established'
  runtime: 'helixd'
  migrated: boolean
}

type HelixdProfileStateTelemetrySink = (line: string) => void

export function formatHelixdProfileStateAuthoritySelected(
  selection: HelixdProfileStateAuthoritySelection
): string {
  // Select fields explicitly so structural typing cannot leak extra runtime data.
  return `[helixd-telemetry] ${JSON.stringify({
    event: 'profile_state_authority_selected',
    backend: selection.backend,
    classification: selection.classification,
    authority_mode: selection.authority_mode,
    runtime: selection.runtime,
    migrated: selection.migrated
  })}`
}

/** Use stderr without desktop dependencies; telemetry failures must not block serving. */
export function emitHelixdProfileStateAuthoritySelected(
  selection: HelixdProfileStateAuthoritySelection,
  sink: HelixdProfileStateTelemetrySink = (line) => console.error(line)
): void {
  try {
    sink(formatHelixdProfileStateAuthoritySelected(selection))
  } catch {}
}
