import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerRequest, WorkerResponse } from '../../src/types.ts'
import { createFetchGate, entryFor, errorOf, resultsOf, settle, type FetchGate } from './helpers.ts'

const ROOT_TITLES = '/vp-search/root.titles.json'
const ROOT_CONTENT = '/vp-search/root.content.json'

let gate: FetchGate
let worker: Worker
let messages: WorkerResponse[]

/** Listens from the moment it is called; `terminate()` drops it again. */
function listen(target: Worker): WorkerResponse[] {
  const seen: WorkerResponse[] = []
  target.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    seen.push(event.data)
  })
  return seen
}

const send = (request: WorkerRequest): void => worker.postMessage(request)

const init = (locale: string): WorkerRequest => ({
  type: 'init',
  base: '/',
  locale,
  entry: entryFor(locale),
})

const waitForCount = (seen: WorkerResponse[], count: number): Promise<void> =>
  vi.waitFor(() => {
    if (seen.length < count) throw new Error(`only ${seen.length} of ${count} messages so far`)
  })

beforeEach(() => {
  gate = createFetchGate()
  vi.stubGlobal('fetch', gate.fetch)
  // The shim's `self` proxy falls through to globalThis, so the stub above is
  // the same `fetch` the worker module sees.
  worker = new Worker(new URL('../../src/worker.ts', import.meta.url), { type: 'module' })
  messages = listen(worker)
})

afterEach(() => {
  worker.terminate()
})

describe('init sequencing', () => {
  it('announces the titles tier before the content fetch completes', async () => {
    gate.hold(ROOT_CONTENT)
    send(init('root'))

    await waitForCount(messages, 1)
    expect(messages).toEqual([{ type: 'tier', tier: 'titles' }])
    // the announcement is genuinely early: content is already in flight
    expect(gate.calls).toEqual([ROOT_TITLES, ROOT_CONTENT])
  })

  it('answers searches from the titles tier alone, with no excerpt', async () => {
    gate.hold(ROOT_CONTENT)
    send(init('root'))
    await waitForCount(messages, 1)

    send({ type: 'search', id: 1, query: 'guide' })
    await waitForCount(messages, 2)

    const response = resultsOf(messages[1])
    expect(response.results).toHaveLength(1)
    expect(response.results[0]?.url).toBe('/guide.html')
    expect(response.results[0]?.excerpt).toBeUndefined()
  })

  it('announces the content tier when it lands and starts serving excerpts', async () => {
    gate.hold(ROOT_CONTENT)
    send(init('root'))
    await waitForCount(messages, 1)

    gate.release(ROOT_CONTENT)
    await waitForCount(messages, 2)
    expect(messages[1]).toEqual({ type: 'tier', tier: 'content' })

    send({ type: 'search', id: 2, query: 'docs', limit: 1 })
    await waitForCount(messages, 3)

    const response = resultsOf(messages[2])
    expect(response.total).toEqual({ count: 2, exact: true })
    expect(response.results).toHaveLength(1)
    expect(response.results[0]?.excerpt).toBeDefined()
  })

  it('correlates each response with the id of its request', async () => {
    send(init('root'))
    await waitForCount(messages, 2)

    send({ type: 'search', id: 41, query: 'guide' })
    send({ type: 'search', id: 42, query: 'config' })
    await waitForCount(messages, 4)

    const [first, second] = [messages[2], messages[3]]
    expect(first).toMatchObject({ type: 'results', id: 41 })
    expect(second).toMatchObject({ type: 'results', id: 42 })
    expect(resultsOf(first).results[0]?.url).toBe('/guide.html')
    expect(resultsOf(second).results[0]?.url).toBe('/config.html')
  })
})

describe('re-init', () => {
  it('re-announces both tiers for the new locale', async () => {
    send(init('root'))
    await waitForCount(messages, 2)
    messages.length = 0

    send(init('zh'))
    await waitForCount(messages, 2)
    expect(messages).toEqual([
      { type: 'tier', tier: 'titles' },
      { type: 'tier', tier: 'content' },
    ])
  })

  it('replaces the previous locale rather than merging into it', async () => {
    send(init('root'))
    await waitForCount(messages, 2)
    send(init('zh'))
    await waitForCount(messages, 4)

    send({ type: 'search', id: 3, query: '指南' })
    await waitForCount(messages, 5)
    expect(resultsOf(messages[4]).results[0]?.url).toBe('/zh/guide.html')

    send({ type: 'search', id: 4, query: 'guide' })
    await waitForCount(messages, 6)
    expect(resultsOf(messages[5]).results).toEqual([])
  })

  it('posts nothing from a superseded init when its held fetch finally lands', async () => {
    gate.hold(ROOT_TITLES)
    send(init('root'))
    // let the held fetch actually be issued before the winner supersedes it
    await vi.waitFor(() => {
      if (!gate.calls.includes(ROOT_TITLES)) throw new Error('titles fetch not issued yet')
    })

    send(init('zh'))
    await waitForCount(messages, 2)
    messages.length = 0

    gate.release(ROOT_TITLES)
    await settle()
    expect(messages).toEqual([])

    send({ type: 'search', id: 5, query: '指南' })
    await waitForCount(messages, 1)
    expect(resultsOf(messages[0]).results[0]?.url).toBe('/zh/guide.html')
  })
})

describe('failures', () => {
  it('reports a failed artifact fetch instead of hanging', async () => {
    send({
      type: 'init',
      base: '/',
      locale: 'missing',
      entry: {
        lang: 'en-US',
        titles: 'vp-search/nope.json',
        content: 'vp-search/nope.json',
        sections: 0,
      },
    })
    await waitForCount(messages, 1)

    expect(messages[0]).toMatchObject({ type: 'error' })
    expect(messages[0]).not.toHaveProperty('id')
    expect(errorOf(messages[0])).toMatch(/404 Not Found for \/vp-search\/nope\.json/)
  })

  it('reports a malformed artifact body as an error', async () => {
    gate.corrupt(ROOT_TITLES)
    send(init('root'))
    await waitForCount(messages, 1)

    expect(messages[0]).toMatchObject({ type: 'error' })
    expect(errorOf(messages[0])).toMatch(/Unexpected token/)
  })

  it('keeps the titles tier usable when only the content tier fails', async () => {
    gate.files.delete(ROOT_CONTENT)
    send(init('root'))
    await waitForCount(messages, 2)

    expect(messages[0]).toEqual({ type: 'tier', tier: 'titles' })
    expect(errorOf(messages[1])).toMatch(/404 Not Found for \/vp-search\/root\.content\.json/)

    send({ type: 'search', id: 6, query: 'guide' })
    await waitForCount(messages, 3)
    expect(resultsOf(messages[2]).results[0]?.url).toBe('/guide.html')
  })

  it('answers a search before any init with an empty, exact response', async () => {
    send({ type: 'search', id: 7, query: 'guide' })
    await waitForCount(messages, 1)

    expect(resultsOf(messages[0])).toMatchObject({
      results: [],
      total: { count: 0, exact: true },
    })
  })
})

describe('dispose', () => {
  it('stops answering once disposed', async () => {
    send(init('root'))
    await waitForCount(messages, 2)

    // The shim maps the worker's `self.close()` onto `terminate()`, which drops
    // the worker's own message listener — so nothing answers afterwards.
    send({ type: 'dispose' })
    const after = listen(worker)
    send({ type: 'search', id: 8, query: 'guide' })
    await settle()

    expect(after).toEqual([])
  })

  it('leaves the pre-dispose transcript untouched', async () => {
    send(init('root'))
    await waitForCount(messages, 2)
    const before = messages.length

    send({ type: 'dispose' })
    send({ type: 'search', id: 9, query: 'guide' })
    await settle()

    expect(messages).toHaveLength(before)
  })
})
