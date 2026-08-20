import { describe, expect, test } from 'vitest'
import { capturedResponse } from './fixtures/docsearch-response.ts'
import { makeAdapter, stubBody, stubJson } from './helpers.ts'

describe('envelope', () => {
  test('total reports nbHits and exhaustiveNbHits', async () => {
    stubJson(capturedResponse())
    const response = await makeAdapter().search('markdown vue config anchors', {})
    // the captured query really matched 779 records; only 6 hits came back
    expect(response.total).toEqual({ count: 779, exact: true })
    expect(response.results).toHaveLength(6)
  })

  test('a non-exhaustive count is reported as inexact', async () => {
    stubJson({ hits: [], nbHits: 1000, exhaustiveNbHits: false })
    const response = await makeAdapter().search('vite', {})
    expect(response.total).toEqual({ count: 1000, exact: false })
  })

  test('a missing exhaustiveNbHits is assumed exact', async () => {
    stubJson({ hits: [], nbHits: 3 })
    const response = await makeAdapter().search('vite', {})
    expect(response.total).toEqual({ count: 3, exact: true })
  })

  test('elapsedMs mirrors processingTimeMS', async () => {
    stubJson({ hits: [], nbHits: 0, processingTimeMS: 12 })
    const response = await makeAdapter().search('vite', {})
    expect(response.elapsedMs).toBe(12)
  })

  test('a zero processingTimeMS is kept, not swallowed as falsy', async () => {
    stubJson({ hits: [], nbHits: 0, processingTimeMS: 0 })
    const response = await makeAdapter().search('vite', {})
    expect(response.elapsedMs).toBe(0)
  })

  test('no timing in the response means no elapsedMs key at all', async () => {
    stubJson({ hits: [], nbHits: 0 })
    const response = await makeAdapter().search('vite', {})
    // exactOptionalPropertyTypes: absent, not present-and-undefined
    expect('elapsedMs' in response).toBe(false)
  })

  test('an empty result set is an empty list with a zero total', async () => {
    stubJson({ hits: [], nbHits: 0, exhaustiveNbHits: true, processingTimeMS: 1 })
    const response = await makeAdapter().search('nothingmatchesthis', {})
    expect(response.results).toEqual([])
    expect(response.total).toEqual({ count: 0, exact: true })
  })

  test('unknown envelope fields are ignored', async () => {
    stubJson({ hits: [], nbHits: 0, page: 0, nbPages: 0, renderingContent: {}, serverTimeMS: 4 })
    const response = await makeAdapter().search('vite', {})
    expect(Object.keys(response).sort()).toEqual(['results', 'total'])
  })
})

describe('error paths', () => {
  test('a non-ok response rejects with the status in the message', async () => {
    stubBody(JSON.stringify({ message: 'Invalid Application-ID or API key', status: 403 }), {
      status: 403,
      statusText: 'Forbidden',
    })
    await expect(makeAdapter().search('vite', {})).rejects.toThrow(/403/)
  })

  test('the rejection carries the backend body, so the cause is visible', async () => {
    stubBody(JSON.stringify({ message: 'index does not exist' }), { status: 404 })
    await expect(makeAdapter().search('vite', {})).rejects.toThrow(/index does not exist/)
  })

  test('a 5xx rejects too', async () => {
    stubBody('upstream exploded', { status: 503 })
    await expect(makeAdapter().search('vite', {})).rejects.toThrow(/503/)
  })

  test('a malformed JSON body rejects', async () => {
    stubBody('<html>gateway timeout</html>')
    await expect(makeAdapter().search('vite', {})).rejects.toThrow()
  })

  test('an abort propagates instead of resolving to an empty response', async () => {
    const controller = new AbortController()
    const mock = stubJson({ hits: [], nbHits: 0 })
    mock.mockImplementationOnce((_input, init) => {
      controller.abort()
      return Promise.reject(init?.signal?.reason)
    })
    await expect(makeAdapter().search('vite', { signal: controller.signal })).rejects.toMatchObject(
      {
        name: 'AbortError',
      },
    )
  })
})
