import { describe, expect, test } from 'vitest'
import {
  API_KEY,
  APP_ID,
  ENDPOINT,
  HOST,
  INDEX,
  makeAdapter,
  POST,
  PRE,
  sentRequest,
  stubJson,
} from './helpers.ts'

const EMPTY = { hits: [], nbHits: 0 }

describe('adapter declaration', () => {
  test('names itself and declares Algolia attribution', () => {
    const adapter = makeAdapter()
    expect(adapter.name).toBe('algolia')
    expect(adapter.attribution).toEqual({ label: 'Algolia', url: 'https://www.algolia.com' })
  })

  test('preconnects to the appId-derived DSN host', () => {
    expect(makeAdapter().preconnect).toEqual([HOST])
  })

  test('has no load or dispose phase — it is a plain HTTP backend', () => {
    const adapter = makeAdapter()
    expect(adapter.load).toBeUndefined()
    expect(adapter.dispose).toBeUndefined()
  })
})

describe('request shape', () => {
  test('POSTs to the appId host and the index query path', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter().search('vite', {})
    const { url, init } = sentRequest(mock)
    expect(url).toBe(ENDPOINT)
    expect(url).toBe(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`)
    expect(init.method).toBe('POST')
  })

  test('sends the credentials as Algolia headers, not query params', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter().search('vite', {})
    const { url, init } = sentRequest(mock)
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Algolia-Application-Id': APP_ID,
      'X-Algolia-API-Key': API_KEY,
    })
    expect(url).not.toContain(API_KEY)
  })

  test('body carries the query and the sentinel-tag search params', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter().search('custom containers', {})
    expect(sentRequest(mock).body).toEqual({
      query: 'custom containers',
      highlightPreTag: PRE,
      highlightPostTag: POST,
      snippetEllipsisText: '…',
      attributesToRetrieve: ['hierarchy', 'content', 'type', 'url'],
      attributesToSnippet: ['content:15'],
    })
  })

  test('sentinel tags are the C0 controls, so indexed text cannot collide', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter().search('vite', {})
    const { body } = sentRequest(mock)
    expect(body['highlightPreTag']).toBe('\u0002')
    expect(body['highlightPostTag']).toBe('\u0003')
  })

  test('ctx.limit becomes hitsPerPage; absent limit omits the key entirely', async () => {
    const withLimit = stubJson(EMPTY)
    await makeAdapter().search('vite', { limit: 7 })
    expect(sentRequest(withLimit).body['hitsPerPage']).toBe(7)

    const without = stubJson(EMPTY)
    await makeAdapter().search('vite', {})
    expect(sentRequest(without).body).not.toHaveProperty('hitsPerPage')
  })

  test('limit 0 is forwarded rather than treated as absent', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter().search('vite', { limit: 0 })
    expect(sentRequest(mock).body['hitsPerPage']).toBe(0)
  })

  test('ctx.lang becomes a lang facet filter; no lang omits facetFilters', async () => {
    const withLang = stubJson(EMPTY)
    await makeAdapter().search('vite', { lang: 'zh-Hans' })
    expect(sentRequest(withLang).body['facetFilters']).toEqual(['lang:zh-Hans'])

    const without = stubJson(EMPTY)
    await makeAdapter().search('vite', {})
    expect(sentRequest(without).body).not.toHaveProperty('facetFilters')
  })

  test('empty-string lang is treated as no lang', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter().search('vite', { lang: '' })
    expect(sentRequest(mock).body).not.toHaveProperty('facetFilters')
  })

  test('ctx.localeIndex is not sent — locale selection is the lang facet', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter().search('vite', { localeIndex: 'zh', lang: 'zh-Hans' })
    expect(sentRequest(mock).body).not.toHaveProperty('localeIndex')
  })

  test('searchParams extend the body', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter({ searchParams: { distinct: 1, filters: 'version:2' } }).search('vite', {})
    const { body } = sentRequest(mock)
    expect(body['distinct']).toBe(1)
    expect(body['filters']).toBe('version:2')
  })

  test('attributesToRetrieve stays overridable — a custom schema needs its own', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter({ searchParams: { attributesToRetrieve: ['title', 'url'] } }).search(
      'vite',
      {},
    )
    expect(sentRequest(mock).body['attributesToRetrieve']).toEqual(['title', 'url'])
  })

  test('searchParams never take over the keys the mapping depends on', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter({
      searchParams: {
        query: 'hijacked',
        highlightPreTag: '<em>',
        highlightPostTag: '</em>',
        snippetEllipsisText: '...',
        attributesToSnippet: ['content:30'],
        hitsPerPage: 999,
      },
    }).search('vite', { limit: 7 })
    expect(sentRequest(mock).body).toEqual({
      query: 'vite',
      highlightPreTag: PRE,
      highlightPostTag: POST,
      snippetEllipsisText: '…',
      attributesToRetrieve: ['hierarchy', 'content', 'type', 'url'],
      attributesToSnippet: ['content:15'],
      hitsPerPage: 7,
    })
  })

  test('searchParams.hitsPerPage applies when the context carries no limit', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter({ searchParams: { hitsPerPage: 25 } }).search('vite', {})
    expect(sentRequest(mock).body['hitsPerPage']).toBe(25)
  })

  test('passes ctx.signal straight through to fetch', async () => {
    const controller = new AbortController()
    const mock = stubJson(EMPTY)
    await makeAdapter().search('vite', { signal: controller.signal })
    expect(sentRequest(mock).init.signal).toBe(controller.signal)
  })

  test('sends signal: null when the context carries none', async () => {
    const mock = stubJson(EMPTY)
    await makeAdapter().search('vite', {})
    expect(sentRequest(mock).init.signal).toBeNull()
  })

  test('reaches the backend only through the global fetch', async () => {
    const boom = new Error('no network in this lane')
    const mock = stubJson(EMPTY)
    mock.mockRejectedValueOnce(boom)
    await expect(makeAdapter().search('vite', {})).rejects.toBe(boom)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

/**
 * DESIGN §3: "adapters translate: Algolia `facetFilters: lang:*` — core strips and re-injects
 * these". The adapter owns that facet: caller filters survive, their `lang:*` entries do not. A
 * stale lang value returns zero hits silently on the public index, which is what makes the strip
 * worth its own block.
 */
describe('facetFilters: the lang facet is the adapter’s', () => {
  /** Runs one search and returns the facetFilters the body carried, if any. */
  async function sentFilters(
    facetFilters: unknown,
    lang?: string,
  ): Promise<Record<string, unknown>> {
    const mock = stubJson(EMPTY)
    await makeAdapter({ searchParams: { facetFilters } }).search('vite', {
      ...(lang != null && { lang }),
    })
    return sentRequest(mock).body
  }

  test('caller filters are kept and the ctx lang filter is appended', async () => {
    const body = await sentFilters(['version:2'], 'en-US')
    expect(body['facetFilters']).toEqual(['version:2', 'lang:en-US'])
  })

  test('a caller lang:* filter is replaced by the ctx one', async () => {
    const body = await sentFilters(['version:2', 'lang:de'], 'en-US')
    expect(body['facetFilters']).toEqual(['version:2', 'lang:en-US'])
  })

  test('a bare-string facetFilters is normalized into the AND-list', async () => {
    expect((await sentFilters('version:2', 'en-US'))['facetFilters']).toEqual([
      'version:2',
      'lang:en-US',
    ])
    expect((await sentFilters('lang:de', 'en-US'))['facetFilters']).toEqual(['lang:en-US'])
  })

  test('strips lang:* from inside an OR-array, keeping its other members', async () => {
    const body = await sentFilters([['lang:de', 'version:2'], 'type:content'], 'en-US')
    expect(body['facetFilters']).toEqual([['version:2'], 'type:content', 'lang:en-US'])
  })

  test('drops an OR-array the strip empties, which would otherwise match nothing', async () => {
    const body = await sentFilters([['lang:de', 'lang:fr'], 'version:2'], 'en-US')
    expect(body['facetFilters']).toEqual(['version:2', 'lang:en-US'])
  })

  test('a negated lang filter is the adapter’s too', async () => {
    const body = await sentFilters(['-lang:de'], 'en-US')
    expect(body['facetFilters']).toEqual(['lang:en-US'])
  })

  test('a facet whose name merely starts with lang is left alone', async () => {
    const body = await sentFilters(['language:go'], 'en-US')
    expect(body['facetFilters']).toEqual(['language:go', 'lang:en-US'])
  })

  test('without a ctx lang nothing is injected and caller lang:* is still stripped', async () => {
    const body = await sentFilters(['version:2', 'lang:de'])
    expect(body['facetFilters']).toEqual(['version:2'])
  })

  test('no ctx lang and nothing left to send omits the key entirely', async () => {
    const body = await sentFilters(['lang:de'])
    expect(body).not.toHaveProperty('facetFilters')
  })

  test('an empty caller list with a ctx lang is just the lang filter', async () => {
    expect((await sentFilters([], 'en-US'))['facetFilters']).toEqual(['lang:en-US'])
  })
})
