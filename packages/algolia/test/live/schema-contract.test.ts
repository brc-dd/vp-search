import { textOf, unescapeEntities, type SearchResponse, type SearchResult } from '@vp-search/core'
import { describe, expect, test, vi } from 'vitest'
import { algoliaAdapter } from '../../src/adapter.ts'
import { capturedResponse } from '../shared/fixtures/docsearch-response.ts'
import { consumedPaths, drift, LEVELS, record, TYPES } from '../shared/schema.ts'

/**
 * Schema-drift contract against the public VitePress DocSearch index — fails naming the field if
 * Algolia or the crawler changes what the adapter reads. Public search-only credentials; gated on
 * VP_SEARCH_LIVE (DESIGN §13).
 */
const LIVE = Boolean(process.env['VP_SEARCH_LIVE'])

const adapter = algoliaAdapter({
  appId: '8J64VVRP8K',
  apiKey: '52f578a92b88ad6abde815aae2b0ad7c',
  indexName: 'vitepress',
})

const PRE = '\u0002'
const POST = '\u0003'
const ZWSP = '\u200B'
/** The index-level default this index falls back to when tags are not sent. */
const LEGACY_TAG = 'algolia-docsearch-suggestion--highlight'

interface Capture {
  /** The body the adapter itself built, not a copy of it. */
  request: Record<string, unknown>
  /** The untouched response envelope. */
  raw: Record<string, unknown>
  hits: Record<string, unknown>[]
  mapped: SearchResponse
}

/**
 * One real query, run through the real adapter with `fetch` teed rather than replaced, so the
 * request under test is the one src builds. Memoized: the whole lane spends three network queries.
 */
const captures = new Map<string, Promise<Capture>>()
/** Serialized: the tee stubs one global that two in-flight captures would fight over. */
let queue: Promise<unknown> = Promise.resolve()
function live(query: string, lang?: string): Promise<Capture> {
  const key = `${query}::${lang ?? ''}`
  let pending = captures.get(key)
  if (!pending) {
    pending = queue.then(() => capture(query, lang))
    queue = pending.catch(() => undefined)
    captures.set(key, pending)
  }
  return pending
}

async function capture(query: string, lang?: string): Promise<Capture> {
  const realFetch = globalThis.fetch
  let request: Record<string, unknown> = {}
  let raw: Record<string, unknown> = {}
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>
    const res = await realFetch(input, init)
    raw = (await res.clone().json()) as Record<string, unknown>
    return res
  })
  try {
    const mapped = await adapter.search(query, { limit: 20, ...(lang != null && { lang }) })
    const hits = Array.isArray(raw['hits']) ? (raw['hits'] as Record<string, unknown>[]) : []
    return { request, raw, hits, mapped }
  } finally {
    vi.unstubAllGlobals()
  }
}

/** Mixed hit types in one response: lvl1, lvl2, lvl3 and content. */
const MIXED = 'markdown vue config anchors'
/** Reliably `type: 'content'` with populated `_snippetResult`. */
const CONTENT = 'heading anchor'

describe.skipIf(!LIVE)('envelope', () => {
  test('carries the fields the adapter reads, with the types it assumes', async () => {
    const { raw } = await live(MIXED)
    expect(Array.isArray(raw['hits']), 'hits: expected an array').toBe(true)
    expect(typeof raw['nbHits'], 'nbHits: expected a number').toBe('number')
    expect(typeof raw['exhaustiveNbHits'], 'exhaustiveNbHits: expected a boolean').toBe('boolean')
    expect(typeof raw['processingTimeMS'], 'processingTimeMS: expected a number').toBe('number')
  })

  test('reaches the mapped response as total and elapsedMs', async () => {
    const { raw, mapped } = await live(MIXED)
    expect(mapped.total).toEqual({ count: raw['nbHits'], exact: raw['exhaustiveNbHits'] })
    expect(mapped.elapsedMs).toBe(raw['processingTimeMS'])
    expect(mapped.results.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!LIVE)('hit schema', () => {
  test('every hit of a mixed-type query matches the consumed contract', async () => {
    const { hits } = await live(MIXED)
    expect(hits.length, 'the query returned nothing to validate').toBeGreaterThan(0)
    expect(drift(hits)).toEqual([])
  })

  test('content hits carry a snippet the adapter can turn into an excerpt', async () => {
    const { hits, mapped } = await live(CONTENT)
    const content = hits.filter((hit) => hit['type'] === 'content')
    expect(content.length, `no type: 'content' hits came back for "${CONTENT}"`).toBeGreaterThan(0)
    expect(drift(hits)).toEqual([])
    for (const [index, hit] of content.entries()) {
      const snippet = record(record(hit['_snippetResult'])['content'])['value']
      expect(typeof snippet, `hits[${index}]._snippetResult.content.value: expected a string`).toBe(
        'string',
      )
    }
    const excerpted = mapped.results.filter((result) => result.kind === 'content')
    expect(excerpted.length).toBe(content.length)
    expect(excerpted.every((result) => 'excerpt' in result)).toBe(true)
  })

  test('all four record types the adapter maps still exist in the index', async () => {
    const [mixed, content] = await Promise.all([live(MIXED), live(CONTENT)])
    const types = new Set([...mixed.hits, ...content.hits].map((hit) => String(hit['type'])))
    // lvl1 -> page, lvl2..6 -> heading, content -> content
    expect(
      [...types].every((type) => TYPES.has(type)),
      `unknown record type in ${[...types]}`,
    ).toBe(true)
    expect(types.has('content'), 'no content records').toBe(true)
    expect(
      [...types].some((type) => type !== 'content'),
      'no hierarchy records',
    ).toBe(true)
  })
})

describe.skipIf(!LIVE)('sentinel round-trip', () => {
  test('the adapter asks for the sentinel tags', async () => {
    const { request } = await live(MIXED)
    expect(request['highlightPreTag']).toBe(PRE)
    expect(request['highlightPostTag']).toBe(POST)
  })

  test('the backend highlights with them, not with the index default tag', async () => {
    const { hits } = await live(MIXED)
    const values = highlightValues(hits)
    expect(values.some((value) => value.includes(PRE) && value.includes(POST))).toBe(true)
    for (const value of values) {
      expect(
        value,
        'index-level default highlight tag came back instead of the sentinels',
      ).not.toContain(LEGACY_TAG)
      expect(value, 'HTML highlight tag came back instead of the sentinels').not.toContain('<em>')
    }
  })

  test('the adapter marks exactly the sentinel-delimited spans', async () => {
    const { hits, mapped } = await live(MIXED)
    const index = hits.findIndex((hit) => ownValue(hit).includes(PRE))
    expect(index, 'no hit had its own level highlighted').toBeGreaterThanOrEqual(0)
    const result = mapped.results[index]
    expect(result).toBeDefined()
    expect(marks(result)).toEqual(spans(ownValue(hits[index] ?? {})))
  })

  test('no sentinel character survives into the output', async () => {
    for (const query of [MIXED, CONTENT]) {
      const { mapped } = await live(query)
      for (const text of allText(mapped.results)) {
        expect(text, `sentinel left in ${JSON.stringify(text)}`).not.toMatch(/[\u0002\u0003]/)
      }
    }
  })
})

describe.skipIf(!LIVE)('output hygiene on live data', () => {
  test('zero-width spaces are stripped from every output string', async () => {
    const { hits, mapped } = await live(MIXED)
    // the crawler still emits them, so this is a live check and not a no-op
    expect(JSON.stringify(hits).includes(ZWSP), 'the crawler stopped emitting U+200B').toBe(true)
    for (const text of allText(mapped.results)) {
      expect(text, `zero-width space left in ${JSON.stringify(text)}`).not.toContain(ZWSP)
    }
  })

  test('HTML entities are decoded in every output string', async () => {
    for (const query of [MIXED, CONTENT]) {
      const { mapped } = await live(query)
      for (const text of allText(mapped.results)) {
        expect(text, `entity left undecoded in ${JSON.stringify(text)}`).not.toMatch(
          /&(amp|lt|gt|quot|#0?39);/i,
        )
      }
    }
  })

  test('titles are trimmed and urls are parseable', async () => {
    const { mapped } = await live(MIXED)
    for (const text of allText(mapped.results)) expect(text).toBe(text.trimEnd())
    for (const result of mapped.results) expect(() => new URL(result.url)).not.toThrow()
  })
})

describe.skipIf(!LIVE)('checked-in fixture is not stale', () => {
  test('a live hit of each captured type has the same consumed paths', async () => {
    const [mixed, content] = await Promise.all([live(MIXED), live(CONTENT)])
    const liveHits = [...mixed.hits, ...content.hits]
    let checked = 0
    for (const [index, hit] of capturedResponse().hits.entries()) {
      const counterpart = liveHits.find((candidate) => candidate['type'] === hit.type)
      if (!counterpart) continue
      checked += 1
      expect(
        consumedPaths(counterpart),
        `fixture hits[${index}] (type ${hit.type}) no longer matches a live record`,
      ).toEqual(consumedPaths(hit as unknown as Record<string, unknown>))
    }
    expect(checked, 'no captured hit type appeared live, cannot judge staleness').toBeGreaterThan(1)
  })
})

describe.skipIf(!LIVE)('CJK', () => {
  test('a Chinese query returns marked results through the lang facet', async () => {
    const { request, mapped } = await live('主题', 'zh-Hans')
    // the index facets lang as zh-Hans, not zh or zh-CN
    expect(request['facetFilters']).toEqual(['lang:zh-Hans'])
    expect(mapped.results.length, 'no results for a Chinese query').toBeGreaterThan(0)
    const marked = mapped.results.filter((result) => marks(result).length > 0)
    expect(marked.length, 'no result carried a mark').toBeGreaterThan(0)
    // invariant, not an exact boundary: ICU/Algolia CJK segmentation may shift
    for (const result of marked) {
      for (const mark of marks(result)) expect(textOf(result.title)).toContain(mark)
    }
    expect(mapped.results.some((result) => /[一-鿿]/.test(textOf(result.title)))).toBe(true)
  })
})

// --- validation helpers -----------------------------------------------------

function highlightValues(hits: Record<string, unknown>[]): string[] {
  return hits.flatMap((hit) =>
    Object.values(record(record(hit['_highlightResult'])['hierarchy'])).map((level) =>
      String(record(level)['value']),
    ),
  )
}

/** The highlighted value of the level the adapter titles the hit with. */
function ownValue(hit: Record<string, unknown>): string {
  const hierarchy = record(hit['hierarchy'])
  const present = LEVELS.filter((level) => hierarchy[level] != null)
  const own = hit['type'] === 'content' ? present.at(-1) : String(hit['type'])
  const value = record(record(record(hit['_highlightResult'])['hierarchy'])[own ?? ''])['value']
  return typeof value === 'string' ? value : ''
}

/** The sentinel-delimited spans of a raw value, normalized the way the adapter does. */
function spans(value: string): string[] {
  return [...value.matchAll(/\u0002([^\u0003]*)\u0003/g)]
    .map((match) => unescapeEntities(match[1] ?? '').replaceAll(ZWSP, ''))
    .filter(Boolean)
}

function marks(result: SearchResult | undefined): string[] {
  return (result?.title ?? []).filter((segment) => segment.mark).map((segment) => segment.text)
}

function allText(results: SearchResult[]): string[] {
  return results.flatMap((result) => [
    textOf(result.title),
    ...(result.titles ?? []).map(textOf),
    ...(result.excerpt ? [textOf(result.excerpt)] : []),
    ...(result.group == null ? [] : [result.group]),
  ])
}
