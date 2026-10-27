import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const getHelixAccountSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.helixAccount.account', 'Helix account'),
    description: translate(
      'auto.components.settings.helixAccount.searchDescription',
      'Sign in or out of the account used by Artifacts and Helix Relay.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.helixAccount.keywordAccount', 'account'),
      ...translateSearchKeyword('auto.components.settings.helixAccount.keywordLogin', 'login'),
      ...translateSearchKeyword('auto.components.settings.helixAccount.keywordLogout', 'logout'),
      ...translateSearchKeyword('auto.components.settings.helixAccount.keywordSignIn', 'sign in'),
      ...translateSearchKeyword('auto.components.settings.helixAccount.keywordSignOut', 'sign out'),
      ...translateSearchKeyword('auto.components.settings.helixAccount.keywordRelay', 'relay'),
      ...translateSearchKeyword('auto.components.settings.helixAccount.keywordCloud', 'cloud')
    ]
  }
])
