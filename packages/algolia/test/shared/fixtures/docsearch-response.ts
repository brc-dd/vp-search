import { readFileSync } from 'node:fs'
import type { DocSearchHit } from '../../../src/adapter.ts'

/**
 * `docsearch-response.json` is a real Algolia response, hand-trimmed.
 *
 * Captured 2026-08-21 from the public VitePress DocSearch index
 * (app `8J64VVRP8K`, index `vitepress`) with the adapter's own request body —
 * sentinel `highlightPreTag`/`highlightPostTag`, `attributesToSnippet:
 * ['content:15']` — for the query **"markdown vue config anchors"**, no
 * `facetFilters`. 6 of its 30 hits were kept, covering: an lvl1 page hit with
 * only lvl0+lvl1; lvl2 and lvl3 heading hits with populated ancestors and
 * marks inside those ancestors; a `content` hit with `_snippetResult.content`;
 * entity-escaped titles (`&amp;`, `&lt;script&gt;`); CJK titles with marks.
 * Every lvl1+ value carries the crawler's trailing `\u200B`.
 *
 * Trimmed per hit to the paths the adapter consumes: `_highlightResult.content`,
 * `hierarchy_camel`, and the `matchLevel`/`matchedWords`/`fullyHighlighted`
 * siblings are dropped; the envelope keeps only `nbHits`, `exhaustiveNbHits`
 * and `processingTimeMS`. `nbHits` is the query's real total, not the kept
 * hit count. The live lane's staleness guard re-checks these paths against a
 * fresh hit of the same `type`.
 */
export interface CapturedResponse {
  hits: DocSearchHit[]
  nbHits: number
  exhaustiveNbHits: boolean
  processingTimeMS: number
}

const url = new URL('./docsearch-response.json', import.meta.url)

/** A fresh deep copy per call, so a test mutating a hit can't leak. */
export function capturedResponse(): CapturedResponse {
  return JSON.parse(readFileSync(url, 'utf8')) as CapturedResponse
}

/** Index into `hits`, by the shape each one is here to exercise. */
export const HIT = {
  /** lvl1 page hit, hierarchy is lvl0+lvl1 only, own level marked. */
  page: 0,
  /** lvl2 heading hit, mark in the lvl1 ancestor as well as its own level. */
  heading: 1,
  /** lvl3 heading hit, `&amp;` in its own level, mark in the lvl1 ancestor. */
  deepHeading: 2,
  /** content hit, `_snippetResult.content` populated, own level is lvl3. */
  content: 3,
  /** lvl2 hit, `&lt;script&gt;`/`&lt;style&gt;` in its own level, CJK ancestor. */
  escaped: 4,
  /** lvl1 page hit with CJK text and marks around Latin runs inside it. */
  cjk: 5,
} as const
