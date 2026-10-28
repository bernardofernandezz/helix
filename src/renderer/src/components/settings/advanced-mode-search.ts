import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

export function getAdvancedModeSearchEntry(): SettingsSearchEntry {
  return {
    title: translate('helix.settings.advancedMode.title', 'Advanced mode'),
    description: translate(
      'helix.settings.advancedMode.description',
      'Show developer tools: git branches, pull requests, source control, checks, ports and issue trackers. Off keeps Helix focused on research.'
    ),
    keywords: [
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.advanced', 'advanced'),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.developer', 'developer'),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.git', 'git'),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.branch', 'branch'),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.pull_request', 'pull request'),
      ...translateSearchKeyword(
        'helix.settings.advancedMode.keyword.source_control',
        'source control'
      ),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.checks', 'checks'),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.ports', 'ports'),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.jira', 'jira'),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.linear', 'linear'),
      ...translateSearchKeyword('helix.settings.advancedMode.keyword.github', 'github')
    ]
  }
}
