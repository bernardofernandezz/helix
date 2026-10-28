import { translate } from '@/i18n/i18n'

export type NativeChatSuggestion = { label: string; prompt: string }

/** Starter prompts for an empty chat; each fills the composer for the user to finish. */
export function nativeChatResearchSuggestions(): NativeChatSuggestion[] {
  return [
    {
      label: translate('helix.nativeChat.suggestions.literature.label', 'Search the literature'),
      prompt: translate(
        'helix.nativeChat.suggestions.literature.prompt',
        'Search PubMed for recent papers on '
      )
    },
    {
      label: translate('helix.nativeChat.suggestions.dataset.label', 'Summarize a dataset'),
      prompt: translate(
        'helix.nativeChat.suggestions.dataset.prompt',
        'Summarize the tables in this project: columns, sample counts and missing values.'
      )
    },
    {
      label: translate('helix.nativeChat.suggestions.variants.label', 'Annotate variants'),
      prompt: translate(
        'helix.nativeChat.suggestions.variants.prompt',
        'Annotate the variants in the VCF files of this project with gene and predicted impact.'
      )
    },
    {
      label: translate('helix.nativeChat.suggestions.protein.label', 'Look up a protein'),
      prompt: translate(
        'helix.nativeChat.suggestions.protein.prompt',
        'Look up this protein in UniProt and summarize its function: '
      )
    }
  ]
}
