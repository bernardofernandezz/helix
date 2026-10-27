import { track } from '@/lib/telemetry'
import type { EventProps } from '../../../../shared/telemetry-events'

export type HelixCliFeatureTipSource = EventProps<'helix_cli_feature_tip_shown'>['source']
export type HelixCliFeatureTipSetupResult =
  EventProps<'helix_cli_feature_tip_setup_result'>['result']
export type CmdJPaletteFeatureTipSource = EventProps<'cmd_j_palette_feature_tip_shown'>['source']

export function getHelixCliFeatureTipTelemetrySource(value: unknown): HelixCliFeatureTipSource {
  return value === 'app_open' ? 'app_open' : 'manual'
}

export function trackHelixCliFeatureTipShown(source: HelixCliFeatureTipSource): void {
  track('helix_cli_feature_tip_shown', { source })
}

export function trackHelixCliFeatureTipSetupClicked(source: HelixCliFeatureTipSource): void {
  track('helix_cli_feature_tip_setup_clicked', { source })
}

export function trackHelixCliFeatureTipSetupResult(
  source: HelixCliFeatureTipSource,
  result: HelixCliFeatureTipSetupResult
): void {
  track('helix_cli_feature_tip_setup_result', { source, result })
}

export function trackCmdJPaletteFeatureTipShown(source: CmdJPaletteFeatureTipSource): void {
  track('cmd_j_palette_feature_tip_shown', { source })
}

export function trackCmdJPaletteFeatureTipAcknowledged(source: CmdJPaletteFeatureTipSource): void {
  track('cmd_j_palette_feature_tip_acknowledged', { source })
}
