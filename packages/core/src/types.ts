/**
 * The shared search data format. Every backend adapter transforms its native
 * output into these shapes; the UI renders only these shapes.
 */

/** One run of text within a highlightable string. */
export interface TextSegment {
  text: string
  /** True when this run matched the query (rendered as `<mark>`). */
  mark?: boolean
}

/**
 * Highlightable text as ordered segments; concatenating `text` yields the
 * plain string. Kept as data rather than HTML so the UI owns escaping,
 * mark styling, and screen-reader output.
 */
export type MarkedText = TextSegment[]

/** What a result points at, when the backend distinguishes. */
export type ResultKind = 'page' | 'heading' | 'content'

export interface SearchResult {
  /** Stable key for list rendering and dedup. Falls back to `url`. */
  id?: string
  /** Link target, anchor included. Prefer site-relative; absolute allowed. */
  url: string
  /** Heading of the matched section, or the page title. */
  title: MarkedText
  /** Ancestor breadcrumb, root-first, excluding `title`. */
  titles?: MarkedText[]
  /** Match-scoped snippet of body text. */
  excerpt?: MarkedText
  /** Top-level grouping label (e.g. DocSearch `hierarchy.lvl0`). The UI falls
   * back to grouping by page (`url` without its anchor) when absent. */
  group?: string
  kind?: ResultKind
  /** Backend-relative, for ordering/debugging only — never comparable across
   * backends and never shown to users. */
  score?: number
  /** The untouched backend hit, for user-level transforms. */
  raw?: unknown
}

export interface SearchTotal {
  count: number
  /** False when the backend estimates (e.g. Meilisearch `estimatedTotalHits`). */
  exact: boolean
}

export interface SearchResponse {
  results: SearchResult[]
  /** Omit when the backend cannot know (e.g. FlexSearch). */
  total?: SearchTotal
  elapsedMs?: number
}

/** Per-query context assembled by the client and passed to adapters. */
export interface SearchContext {
  /** VitePress locale key, e.g. 'root', 'zh'. Selects per-locale indexes. */
  localeIndex?: string
  /** Site lang, e.g. 'en-US'. For language-filtered backends. */
  lang?: string
  /** Cap on returned results. Omitted = the backend's own default for
   * remote adapters, uncapped for local ones. */
  limit?: number
  /** Aborted when the query is superseded; pass to fetch. */
  signal?: AbortSignal
}
