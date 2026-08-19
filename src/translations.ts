/**
 * UI strings. Keys shared with VitePress's `LocalSearchTranslations` keep their
 * names and semantics so existing config carries over.
 */
export interface SearchButtonTranslations {
  buttonText?: string
  buttonAriaLabel?: string
}

export interface SearchFooterTranslations {
  selectText?: string
  selectKeyAriaLabel?: string
  navigateText?: string
  navigateUpKeyAriaLabel?: string
  navigateDownKeyAriaLabel?: string
  closeText?: string
  closeKeyAriaLabel?: string
}

export interface SearchModalTranslations {
  /** Accessible name of the dialog and of its input. */
  title?: string
  placeholderText?: string
  idleText?: string
  resetButtonTitle?: string
  backButtonTitle?: string
  /** Accessible name of the results listbox. */
  resultsLabel?: string
  /** Rendered before the quoted query, as in core. */
  noResultsText?: string
  errorText?: string
  retryText?: string
  searchByText?: string
  /** Live-region templates; `{count}` and `{query}` are substituted. */
  announceResultsText?: string
  announceOneResultText?: string
  announceNoResultsText?: string
  footer?: SearchFooterTranslations
}

export interface SearchTranslations {
  button?: SearchButtonTranslations
  modal?: SearchModalTranslations
}

/** Shape of the `virtual:any-search/options` default export. */
export interface SearchOptions {
  translations?: SearchTranslations
  /** Keyed by VitePress `localeIndex` ('root', 'zh', …). */
  locales?: Record<string, { translations?: SearchTranslations }>
}

type TranslationKeys<T> = {
  [K in keyof T & string]: NonNullable<T[K]> extends string
    ? K
    : `${K}.${TranslationKeys<NonNullable<T[K]>>}`
}[keyof T & string]

export type SearchTranslationKey = TranslationKeys<SearchTranslations>

export const defaultTranslations: SearchTranslations = {
  button: {
    buttonText: 'Search',
    buttonAriaLabel: 'Search',
  },
  modal: {
    title: 'Search',
    placeholderText: 'Search docs',
    idleText: 'Type to search the documentation',
    resetButtonTitle: 'Clear search',
    backButtonTitle: 'Close search',
    resultsLabel: 'Search results',
    noResultsText: 'No results for',
    errorText: 'Search is unavailable right now.',
    retryText: 'Try again',
    searchByText: 'Search by ',
    announceResultsText: '{count} results for {query}',
    announceOneResultText: '1 result for {query}',
    announceNoResultsText: 'No results for {query}',
    footer: {
      selectText: 'to select',
      selectKeyAriaLabel: 'enter',
      navigateText: 'to navigate',
      navigateUpKeyAriaLabel: 'up arrow',
      navigateDownKeyAriaLabel: 'down arrow',
      closeText: 'to close',
      closeKeyAriaLabel: 'escape',
    },
  },
}

/**
 * Resolves one key against locale overrides, then root overrides, then the
 * defaults. Each source is walked independently, so a locale that translates
 * only part of a section doesn't shadow the deeper keys it left out.
 */
export function createSearchTranslate(
  options: SearchOptions | undefined,
  localeIndex: string,
): (key: SearchTranslationKey) => string {
  const sources = [
    options?.locales?.[localeIndex]?.translations,
    options?.translations,
    defaultTranslations,
  ]
  return (key) => {
    const path = key.split('.')
    for (const source of sources) {
      const value = lookup(source, path)
      if (typeof value === 'string') return value
    }
    return ''
  }
}

function lookup(source: unknown, path: string[]): unknown {
  let value = source
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}
