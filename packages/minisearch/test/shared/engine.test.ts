import { textOf, type SearchResponse } from '@vp-search/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { excerpt, loadTier, runSearch, type LoadedTier, type TierState } from '../../src/engine.ts'
import { CONTENT_FIELDS, CONTENT_STORE_FIELDS } from '../../src/fields.ts'
import type { Artifact } from '../../src/types.ts'
import {
  buildArtifact,
  contentArtifact,
  hit,
  hitFor,
  LONG,
  marked,
  marksOf,
  titlesArtifact,
  ZH_LANG,
  ZH_RECORDS,
} from './helpers.ts'

let titles: LoadedTier
let content: LoadedTier
let both: TierState

const urls = (response: SearchResponse): string[] =>
  response.results.map((result) => result.url).sort()

beforeAll(() => {
  titles = loadTier(titlesArtifact())
  content = loadTier(contentArtifact())
  both = { titles, content }
})

describe('tier selection', () => {
  it('returns an empty, exact response when no tier is loaded', () => {
    const response = runSearch({}, 'docs')
    expect(response.results).toEqual([])
    expect(response.total).toEqual({ count: 0, exact: true })
  })

  it('answers from the titles tier before content arrives', () => {
    expect(runSearch({ titles }, 'guide').results.length).toBeGreaterThan(0)
  })

  it('carries no excerpt on the titles tier, which does not store text', () => {
    const response = runSearch({ titles }, 'guide')
    expect(response.results.every((result) => result.excerpt === undefined)).toBe(true)
  })

  it('does not match body text from the titles tier', () => {
    expect(runSearch({ titles }, 'docs').results).toEqual([])
  })

  it('supersedes titles with content once it is loaded', () => {
    expect(runSearch(both, 'docs').results).toHaveLength(5)
  })

  it('keeps using content even when both tiers are present', () => {
    expect(hit(runSearch(both, 'hydration')).excerpt).toBeDefined()
  })

  it('answers a group-label query the same from either tier', () => {
    // The upgrade must be monotonic. `Reference` is only a sidebar label on
    // `/config/index.html#markdown` — nothing in its title or breadcrumb —
    // so it is exactly the hit a content tier that stopped indexing `group`
    // would swallow the moment it superseded titles.
    const early = urls(runSearch({ titles }, 'Reference'))
    expect(early).toContain('/config/index.html#markdown')
    expect(urls(runSearch(both, 'Reference'))).toEqual(early)
  })
})

describe('totals and cap', () => {
  it('counts every hit before the cap is applied', () => {
    expect(runSearch(both, 'docs', 2).total).toEqual({ count: 5, exact: true })
  })

  it('reports the total as exact', () => {
    expect(runSearch(both, 'docs').total?.exact).toBe(true)
  })

  it('caps results without capping the total', () => {
    const capped = runSearch(both, 'docs', 2)
    expect(capped.results).toHaveLength(2)
    expect(capped.total?.count).toBe(5)
  })

  it('returns every hit when no limit is passed', () => {
    // The engine has no default cap; the 12-result cap is the client's
    // (`LIMIT` in packages/core/src/client/VPSearchBox.vue).
    const response = runSearch(both, 'docs')
    expect(response.results).toHaveLength(response.total?.count ?? -1)
  })

  it('orders results by descending score', () => {
    const scores = runSearch(both, 'docs').results.map((result) => result.score ?? 0)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('treats a limit of zero as an empty page of a non-empty total', () => {
    const response = runSearch(both, 'docs', 0)
    expect(response.results).toEqual([])
    expect(response.total?.count).toBe(5)
  })
})

describe('result mapping', () => {
  it('uses the record id, anchor included, as the url', () => {
    expect(hit(runSearch(both, 'markdown')).url).toBe('/config/index.html#markdown')
  })

  it('passes group through', () => {
    expect(hit(runSearch(both, 'markdown')).group).toBe('Reference')
  })

  it('passes kind through', () => {
    expect(hit(runSearch(both, 'markdown')).kind).toBe('heading')
  })

  it('reports a numeric score', () => {
    expect(hit(runSearch(both, 'markdown')).score).toBeTypeOf('number')
  })

  it('reports elapsedMs', () => {
    expect(runSearch(both, 'docs').elapsedMs).toBeTypeOf('number')
  })

  it('maps the breadcrumb into one MarkedText per ancestor', () => {
    const result = hit(runSearch(both, 'markdown'))
    expect(result.titles).toHaveLength(1)
    expect(textOf(marked(result.titles?.[0]))).toBe('Configuration')
  })

  it('omits absent fields rather than sending undefined over postMessage', () => {
    const result = hitFor(runSearch({ titles }, 'guide'), '/guide/index.html')
    expect(Object.keys(result)).not.toContain('excerpt')
    expect(Object.keys(result)).toContain('group')
  })

  it('keeps an empty stored titles off the payload too', () => {
    // A page record stores `titles: []`; an empty array is truthy, so only a
    // length test keeps it from riding along on every such hit.
    const result = hitFor(runSearch({ titles }, 'guide'), '/guide/index.html')
    expect('titles' in result).toBe(false)
  })
})

describe('marks', () => {
  it('marks the whole document term for a prefix match', () => {
    const result = hitFor(runSearch(both, 'config'), '/config/index.html#markdown')
    expect(marksOf(marked(result.titles?.[0]))).toContain('Configuration')
  })

  it('marks the body match inside the excerpt', () => {
    const result = hitFor(runSearch(both, 'config'), '/config/index.html#markdown')
    expect(marksOf(marked(result.excerpt))).toContain('configured')
  })

  it('marks the matched term in the title', () => {
    expect(marksOf(hit(runSearch(both, 'rendering')).title)).toContain('Rendering')
  })

  it('marks the document term, not the typo, for a fuzzy match', () => {
    const result = hit(runSearch(both, 'markdwon'))
    expect(result.url).toBe('/config/index.html#markdown')
    expect(marksOf(result.title)).toEqual(['Markdown'])
  })

  it('renders marked title text as tagged text', () => {
    expect(hit(runSearch(both, 'rendering')).title).toMatchInlineSnapshot(`<mark>Rendering</mark>`)
  })
})

describe('excerpt windowing', () => {
  it('elides both ends when the match sits mid-text', () => {
    const text = textOf(marked(hit(runSearch(both, 'hydration')).excerpt))
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
  })

  it('keeps the window far shorter than the section text', () => {
    const text = textOf(marked(hit(runSearch(both, 'hydration')).excerpt))
    expect(text.length).toBeLessThan(LONG.length / 2)
  })

  it('keeps context on both sides of the match', () => {
    const text = textOf(marked(hit(runSearch(both, 'hydration')).excerpt))
    expect(text).toMatch(/\S+ hydration \S+/i)
  })

  it('marks the match inside the window', () => {
    expect(marksOf(marked(hit(runSearch(both, 'hydration')).excerpt))).toContain('hydration')
  })

  it('leaves short text un-elided', () => {
    const result = hitFor(runSearch(both, 'installation'), '/guide/index.html')
    expect(textOf(marked(result.excerpt))).not.toContain('…')
    expect(marked(result.excerpt)).toMatchInlineSnapshot(
      `The docs guide covers <mark>installation</mark>.`,
    )
  })

  it('elides only the lead when the window runs to the end of the text', () => {
    const text = textOf(marked(hit(runSearch(both, 'snippets')).excerpt))
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(false)
  })

  it('falls back to a lead-in excerpt when no term matches the body', () => {
    const text = textOf(excerpt(LONG, ['absent']))
    expect(text.startsWith('VitePress reads')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
  })

  it('leaves text with no terms at all unmarked and un-elided at the lead', () => {
    expect(textOf(excerpt('a short line', []))).toBe('a short line')
  })
})

describe('searchOptions', () => {
  it('applies the VitePress local-search parity defaults', () => {
    expect(titles.searchOptions).toEqual({
      fuzzy: 0.2,
      prefix: true,
      boost: { title: 4, text: 2, titles: 1 },
    })
  })

  it('lets the artifact win and merges boost per field', () => {
    const tuned = loadTier(
      buildArtifact({
        fields: ['title', 'titles', 'text'],
        storeFields: ['title', 'text'],
        searchOptions: { fuzzy: false, boost: { title: 9 } },
      }),
    )
    expect(tuned.searchOptions).toEqual({
      fuzzy: false,
      prefix: true,
      boost: { title: 9, text: 2, titles: 1 },
    })
  })

  it('leaves the defaults intact when one tier overrides them', () => {
    expect(titles.searchOptions.boost).toEqual({ title: 4, text: 2, titles: 1 })
  })
})

describe('artifact options carry data, never code (#3685)', () => {
  /** An artifact that smuggles a `tokenize` past the type, as a tampered or
   * hand-written one could. `loadTier` spreads `options` and then assigns its
   * own tokenizer, so this is a guard on that assignment's ORDER. */
  const smuggled = (): Artifact => {
    const artifact = buildArtifact({
      fields: [...CONTENT_FIELDS],
      storeFields: [...CONTENT_STORE_FIELDS],
      records: ZH_RECORDS,
      lang: ZH_LANG,
    })
    ;(artifact.options as Record<string, unknown>)['tokenize'] = () => ['nonsense']
    return artifact
  }

  it('segments a CJK query with the engine tokenizer, not the artifact one', () => {
    // '生成器' lives inside an unspaced run, so it is only reachable through
    // `createTokenizer(lang)`; the smuggled tokenizer answers 'nonsense' to
    // everything and would return nothing here.
    const tier = loadTier(smuggled())
    expect(urls(runSearch({ content: tier }, '生成器'))).toContain('/zh/guide/index.html#快速开始')
  })

  it('does not let the smuggled tokenizer define the query terms', () => {
    const tier = loadTier(smuggled())
    expect(runSearch({ content: tier }, 'nonsense').results).toEqual([])
  })
})

describe('result shape', () => {
  /** DESIGN §1: the required core plus the optional fields, nothing else.
   * `raw` is absent by choice on this adapter (postMessage weight, TODO §6);
   * the allowlist is what a result MAY carry, not what it must. */
  const ALLOWED = ['id', 'url', 'title', 'titles', 'excerpt', 'group', 'kind', 'score', 'raw']

  const everyResult = (): SearchResponse['results'] => [
    ...runSearch(both, 'docs').results,
    ...runSearch(both, 'markdown').results,
    ...runSearch({ titles }, 'guide').results,
    ...runSearch(both, '生成器').results,
  ]

  it('emits no key outside the shared format', () => {
    const extra = [...new Set(everyResult().flatMap(Object.keys))].filter(
      (key) => !ALLOWED.includes(key),
    )
    expect(extra).toEqual([])
  })

  it('always carries the required core: a string url and a MarkedText title', () => {
    const results = everyResult()
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.url).toBeTypeOf('string')
      expect(Array.isArray(result.title)).toBe(true)
      for (const segment of result.title) expect(segment.text).toBeTypeOf('string')
    }
  })

  it('never leaks a stored index field onto a result', () => {
    // `text` and `kind` are stored, but only `kind` is part of the format.
    expect(everyResult().some((result) => 'text' in result)).toBe(false)
  })
})
