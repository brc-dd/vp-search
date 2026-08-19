export type * from './types.ts'
export { defineSearchAdapter } from './adapter.ts'
export type { SearchAdapter, SearchAttribution } from './adapter.ts'
export {
  plain,
  textOf,
  fromTagged,
  fromRanges,
  fromTerms,
  type HighlightRange,
} from './highlight.ts'
export { algoliaAdapter, type AlgoliaAdapterOptions } from './adapters/algolia.ts'
