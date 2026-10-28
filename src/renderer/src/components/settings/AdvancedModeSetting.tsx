import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { isAdvancedMode } from '../../../../shared/advanced-mode'
import { getAdvancedModeSearchEntry } from './advanced-mode-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'

export function AdvancedModeSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const entry = getAdvancedModeSearchEntry()
  const enabled = isAdvancedMode(settings)
  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
    >
      <SettingsSwitchRow
        label={entry.title}
        description={entry.description}
        checked={enabled}
        onChange={() => updateSettings({ advancedMode: !enabled })}
      />
    </SearchableSetting>
  )
}
