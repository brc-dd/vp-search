import type { SearchContext, SearchResponse } from './types.ts'

/** Shown by the powered-by slot's default content when provided. */
export interface SearchAttribution {
  label: string
  url?: string
}

export interface SearchAdapter {
  /** Backend identifier, e.g. 'algolia'. Used for classes and debugging. */
  name: string
  attribution?: SearchAttribution
  /** Origins worth a `<link rel="preconnect">` before the first search. */
  preconnect?: string[]
  /**
   * Lazy one-time setup (import the backend library, fetch the index).
   * The client memoizes it; adapters don't need to.
   */
  load?(ctx: SearchContext): Promise<void> | void
  /** Never called with an empty query. */
  search(query: string, ctx: SearchContext): Promise<SearchResponse> | SearchResponse
  dispose?(): void
}

export function defineSearchAdapter(adapter: SearchAdapter): SearchAdapter {
  return adapter
}
