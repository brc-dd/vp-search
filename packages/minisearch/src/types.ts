import type { ResultKind, SearchResponse } from '@vp-search/core'
import type { SearchOptions as EngineSearchOptions } from 'minisearch'

/** One locale's artifact pair. Tier values are URLs relative to the site base. */
export interface LocaleEntry {
  lang: string
  titles: string
  content: string
  sections: number
}

/**
 * Default export of `virtual:vp-search/minisearch/manifest`. Dev inlines `locales`; a build leaves
 * it null and points `manifest` at the same record on disk.
 */
export interface IndexData {
  base: string
  locales: Record<string, LocaleEntry> | null
  manifest: string | null
}

export type Tier = 'titles' | 'content'

/** One tier's file. `index` is `MiniSearch.toJSON()`, already stringified. */
export interface Artifact {
  v: 1
  lang: string
  options: {
    fields: string[]
    storeFields: string[]
    searchOptions?: EngineSearchOptions
  }
  index: string
}

/** A stored record; `id` is the site-relative URL, anchor included. */
export interface IndexRecord {
  id: string
  title: string
  titles?: string[]
  /** Content tier only. */
  text?: string
  group?: string
  kind?: ResultKind
  [extraField: string]: unknown
}

export interface InitRequest {
  type: 'init'
  base: string
  locale: string
  entry: LocaleEntry
}

export interface SearchRequest {
  type: 'search'
  id: number
  query: string
  limit?: number
}

export type WorkerRequest = InitRequest | SearchRequest | { type: 'dispose' }

export type WorkerResponse =
  | { type: 'tier'; tier: Tier }
  | { type: 'results'; id: number; response: SearchResponse }
  /**
   * Without this, a failed artifact fetch would hang `load()` forever: an async handler's rejection
   * never reaches the worker's `error` event.
   */
  | { type: 'error'; id?: number; message: string }
