import { expect, vi, type Mock } from 'vitest'
import { algoliaAdapter, type AlgoliaAdapterOptions } from '../../src/adapter.ts'

export const APP_ID = 'TESTAPP01'
export const API_KEY = 'test-search-only-key'
export const INDEX = 'testindex'
export const HOST = `https://${APP_ID}-dsn.algolia.net`
export const ENDPOINT = `${HOST}/1/indexes/${INDEX}/query`

/** Sentinel highlight tags, restated here so a change in src has to be deliberate. */
export const PRE = '\u0002'
export const POST = '\u0003'
export const ZWSP = '\u200B'

export function makeAdapter(options: Partial<AlgoliaAdapterOptions> = {}) {
  return algoliaAdapter({ appId: APP_ID, apiKey: API_KEY, indexName: INDEX, ...options })
}

export type FetchMock = Mock<typeof fetch>

/**
 * Replaces the global `fetch` and asserts the replacement took, so a test can never silently reach
 * the network.
 */
export function stubFetch(
  impl: (...args: Parameters<typeof fetch>) => Promise<Response>,
): FetchMock {
  const mock = vi.fn<typeof fetch>(impl)
  vi.stubGlobal('fetch', mock)
  expect(globalThis.fetch).toBe(mock)
  return mock
}

export function stubJson(body: unknown, init: ResponseInit = {}): FetchMock {
  return stubBody(JSON.stringify(body), init)
}

export function stubBody(body: string, init: ResponseInit = {}): FetchMock {
  return stubFetch(() =>
    Promise.resolve(
      new Response(body, { headers: { 'Content-Type': 'application/json' }, ...init }),
    ),
  )
}

export interface SentRequest {
  url: string
  init: RequestInit
  body: Record<string, unknown>
}

export function sentRequest(mock: FetchMock, index = 0): SentRequest {
  const call = mock.mock.calls[index]
  if (!call) throw new Error(`fetch was never called with index ${index}`)
  const [input, init = {}] = call
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> }
}
