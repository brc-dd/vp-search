import type { SearchContext, SearchResponse } from './types.ts'

/** Rendered in the results footer when the adapter provides it. */
export interface SearchAttribution {
  label: string
  url?: string
}

export interface SearchAdapter {
  /** Backend identifier, e.g. 'algolia'. */
  name: string
  attribution?: SearchAttribution
  /** Origins worth a `<link rel="preconnect">` before the first search. */
  preconnect?: string[]
  /** Lazy one-time setup (import the backend library, fetch the index); the client memoizes it. */
  load?(ctx: SearchContext): Promise<void> | void
  /** Never called with an empty query. */
  search(query: string, ctx: SearchContext): Promise<SearchResponse> | SearchResponse
  /**
   * Called when already-returned results may have improved (e.g. a richer index tier finished
   * loading); the client re-runs the active query. Returns an unsubscribe function.
   */
  onInvalidate?(listener: () => void): () => void
  dispose?(): void
}

export function defineSearchAdapter(adapter: SearchAdapter): SearchAdapter {
  return adapter
}
