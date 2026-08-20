import MiniSearch, {
  type SearchOptions as EngineSearchOptions,
  type SearchResult as EngineResult,
} from 'minisearch'
import { fromTerms } from '../../highlight.ts'
import { createTokenizer } from '../../local/tokenize.ts'
import type { MarkedText, SearchResponse, SearchResult } from '../../types.ts'
import type { Artifact, IndexRecord } from './types.ts'

/** VitePress local-search parity; the artifact's own options win over these. */
const DEFAULT_SEARCH_OPTIONS = {
  fuzzy: 0.2,
  prefix: true,
  boost: { title: 4, text: 2, titles: 1 },
} satisfies EngineSearchOptions

const DEFAULT_LIMIT = 20
const CONTEXT_WORDS = 15
/** CJK has no spaces, so word counting alone would take in a whole section. */
const CONTEXT_CHARS = 120
const SPACE = /\s/

export interface LoadedTier {
  engine: MiniSearch<IndexRecord>
  searchOptions: EngineSearchOptions
}

/** One locale's tiers; `content` arrives after `titles` and supersedes it. */
export interface TierState {
  titles?: LoadedTier
  content?: LoadedTier
}

export function loadTier(artifact: Artifact): LoadedTier {
  const { searchOptions } = artifact.options
  return {
    // Tokenizers are code, never serialized: build and query must use the same
    // one, or matching degrades silently.
    engine: MiniSearch.loadJSON<IndexRecord>(artifact.index, {
      ...artifact.options,
      idField: 'id',
      tokenize: createTokenizer(artifact.lang),
    }),
    searchOptions: {
      ...DEFAULT_SEARCH_OPTIONS,
      ...searchOptions,
      boost: { ...DEFAULT_SEARCH_OPTIONS.boost, ...searchOptions?.boost },
    },
  }
}

export function runSearch(state: TierState, query: string, limit?: number): SearchResponse {
  const tier = state.content ?? state.titles
  if (!tier) return { results: [], total: { count: 0, exact: true } }
  const started = performance.now()
  const hits = tier.engine.search(query, tier.searchOptions)
  return {
    results: hits.slice(0, limit ?? DEFAULT_LIMIT).map(toResult),
    total: { count: hits.length, exact: true },
    elapsedMs: performance.now() - started,
  }
}

function toResult(hit: EngineResult): SearchResult {
  const record = hit as unknown as IndexRecord
  return {
    url: record.id,
    title: fromTerms(record.title, hit.terms),
    titles: record.titles?.map((title) => fromTerms(title, hit.terms)),
    excerpt: record.text ? excerpt(record.text, hit.terms) : undefined,
    group: record.group,
    kind: record.kind,
    score: hit.score,
  }
}

/** A window of `text` around its first match, marked and elided at the cuts. */
export function excerpt(text: string, terms: readonly string[]): MarkedText {
  const [from, to] = firstMatch(text, terms)
  const start = windowStart(text, from)
  const end = windowEnd(text, to)
  return fromTerms(
    (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''),
    terms,
  )
}

/** Longest term first, so the window anchors on the most specific match; terms
 * that matched another field only are skipped. */
function firstMatch(text: string, terms: readonly string[]): [number, number] {
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const match = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(text)
    if (match) return [match.index, match.index + match[0].length]
  }
  return [0, 0]
}

function windowStart(text: string, index: number): number {
  const limit = Math.max(0, index - CONTEXT_CHARS)
  let cursor = index
  for (let words = 0; words < CONTEXT_WORDS && cursor > limit; words++) {
    while (cursor > limit && SPACE.test(text.charAt(cursor - 1))) cursor--
    while (cursor > limit && !SPACE.test(text.charAt(cursor - 1))) cursor--
  }
  return cursor
}

function windowEnd(text: string, index: number): number {
  const limit = Math.min(text.length, index + CONTEXT_CHARS)
  let cursor = index
  for (let words = 0; words < CONTEXT_WORDS && cursor < limit; words++) {
    while (cursor < limit && SPACE.test(text.charAt(cursor))) cursor++
    while (cursor < limit && !SPACE.test(text.charAt(cursor))) cursor++
  }
  return cursor
}
