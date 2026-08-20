export type * from './types.ts'
export { defineSearchAdapter } from './adapter.ts'
export type { SearchAdapter, SearchAttribution } from './adapter.ts'
export {
  plain,
  textOf,
  fromTagged,
  fromRanges,
  fromTerms,
  unescapeEntities,
  type HighlightRange,
} from './highlight.ts'
export {
  createSearchTranslate,
  defaultTranslations,
  type SearchOptions,
  type SearchTranslationKey,
  type SearchTranslations,
} from './translations.ts'
