/**
 * The result-shape allowlist. DESIGN §1 draws the format as a required core plus optional fields
 * plus `raw`; §10 records four things deliberately left out (positions, `subResults`,
 * `matchedTerms`, a `meta` bag). Those omissions are only real if adapters cannot quietly
 * reintroduce them, so this asserts the closed key set over the real mapper — every hit of the
 * captured response, plus the degenerate hits the mapper has to survive.
 *
 * A sibling block covers the minisearch mapper in `packages/minisearch/test/shared/engine.test.ts`.
 */

import type { SearchResult } from '@vp-search/core'
import { describe, expect, test } from 'vitest'
import type { DocSearchHit } from '../../src/adapter.ts'
import { capturedResponse } from './fixtures/docsearch-response.ts'
import { makeAdapter, stubJson } from './helpers.ts'

/** Everything `SearchResult` declares, and nothing else. */
const ALLOWED = ['id', 'url', 'title', 'titles', 'excerpt', 'group', 'kind', 'score', 'raw']

async function mapHits(hits: DocSearchHit[]): Promise<SearchResult[]> {
  stubJson({ hits, nbHits: hits.length, exhaustiveNbHits: true })
  return (await makeAdapter().search('markdown vue config anchors', {})).results
}

/** A hit stripped to the fields the mapper cannot do without. */
const bareHit = (): DocSearchHit => ({
  objectID: 'bare',
  url: 'https://example.test/page',
  type: 'lvl1',
  content: null,
  hierarchy: { lvl0: 'Group', lvl1: 'Page' },
})

describe('every mapped result', () => {
  test('carries no key outside the shared format', async () => {
    const results = await mapHits([...capturedResponse().hits, bareHit()])
    const extra = [...new Set(results.flatMap(Object.keys))].filter((key) => !ALLOWED.includes(key))

    expect(results.length).toBeGreaterThan(6)
    expect(extra).toEqual([])
  })

  test('has a string url', async () => {
    for (const result of await mapHits([...capturedResponse().hits, bareHit()])) {
      expect(result.url).toBeTypeOf('string')
      expect(result.url.length).toBeGreaterThan(0)
    }
  })

  test('has a MarkedText title — an array of `{ text }` segments', async () => {
    for (const result of await mapHits([...capturedResponse().hits, bareHit()])) {
      expect(Array.isArray(result.title)).toBe(true)
      for (const segment of result.title) {
        expect(segment.text).toBeTypeOf('string')
        expect(Object.keys(segment).every((key) => key === 'text' || key === 'mark')).toBe(true)
      }
    }
  })

  test('reintroduces none of the DESIGN §10 omissions', async () => {
    // The DocSearch hit carries `_highlightResult` positions-adjacent data and
    // `matchedWords`; `raw` is the only place any of it may surface.
    const results = await mapHits(capturedResponse().hits)
    for (const key of ['positions', 'subResults', 'matchedTerms', 'meta', '_highlightResult']) {
      expect(results.some((result) => key in result)).toBe(false)
    }
  })

  test('keeps the untouched hit reachable through raw, and only through raw', async () => {
    const hits = capturedResponse().hits
    const results = await mapHits(hits)
    expect(results[0]?.raw).toEqual(hits[0])
  })
})
