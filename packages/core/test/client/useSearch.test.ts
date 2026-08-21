import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick, watch } from 'vue'
import type { SearchAdapter } from '../../src/adapter.ts'
import { useSearch, type UseSearchOptions } from '../../src/client/useSearch.ts'
import type { SearchContext, SearchResponse } from '../../src/types.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function response(...urls: string[]): SearchResponse {
  return {
    results: urls.map((url) => ({ url, title: [{ text: url }] })),
    total: { count: urls.length, exact: true },
  }
}

type SearchFn = (query: string, ctx: SearchContext) => Promise<SearchResponse> | SearchResponse

/** A fake whose every call is recorded, so ctx/signal identity is assertable. */
function fake(impl: SearchFn = (query) => response(`/${query}`)) {
  return vi.fn<SearchFn>(impl)
}

function signalOf(search: ReturnType<typeof fake>, call: number): AbortSignal {
  const ctx = search.mock.calls[call]?.[1]
  if (!ctx?.signal) throw new Error(`no signal recorded for call ${call}`)
  return ctx.signal
}

/** `useSearch` inside a real scope, so disposal is exercised as it ships. */
function setup(options: UseSearchOptions) {
  const scope = effectScope()
  const api = scope.run(() => useSearch(options))
  if (!api) throw new Error('scope.run returned nothing')
  scopes.push(scope)
  return { ...api, stop: () => scope.stop() }
}

const scopes: ReturnType<typeof effectScope>[] = []

/** Advance timers, then let the watcher/promise chain settle. */
async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

/** Assigning `query` schedules through a pre-flush watcher, not synchronously. */
async function search(query: { value: string }, value: string, ms = 200) {
  query.value = value
  await nextTick()
  await tick(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
})

describe('debounce', () => {
  test('waits 200ms by default', async () => {
    const searchFn = fake()
    const { query } = setup({ adapter: { name: 'fake', search: searchFn } })

    query.value = 'vue'
    await nextTick()
    await tick(199)
    expect(searchFn).not.toHaveBeenCalled()

    await tick(1)
    expect(searchFn).toHaveBeenCalledTimes(1)
  })

  test('honours a custom debounce', async () => {
    const searchFn = fake()
    const { query } = setup({ adapter: { name: 'fake', search: searchFn }, debounce: 50 })

    query.value = 'vue'
    await nextTick()
    await tick(49)
    expect(searchFn).not.toHaveBeenCalled()

    await tick(1)
    expect(searchFn).toHaveBeenCalledTimes(1)
  })

  test('trims the query before it reaches the adapter', async () => {
    const searchFn = fake()
    const { query, status } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, '  vue  ')
    expect(searchFn).toHaveBeenCalledWith('vue', expect.anything())
    expect(status.value).toBe('done')
  })

  test('rapid retypes collapse into one search', async () => {
    const searchFn = fake()
    const { query } = setup({ adapter: { name: 'fake', search: searchFn } })

    for (const value of ['v', 'vu', 'vue']) {
      query.value = value
      await nextTick()
      await tick(50)
    }
    expect(searchFn).not.toHaveBeenCalled()

    await tick(200)
    expect(searchFn).toHaveBeenCalledTimes(1)
    expect(searchFn).toHaveBeenCalledWith('vue', expect.anything())
  })
})

describe('empty query', () => {
  test('clears results and returns to idle without calling the adapter', async () => {
    const searchFn = fake()
    const { query, results, total, status } = setup({
      adapter: { name: 'fake', search: searchFn },
    })

    await search(query, 'vue')
    expect(results.value).toHaveLength(1)
    expect(total.value).toEqual({ count: 1, exact: true })
    expect(status.value).toBe('done')

    await search(query, '')
    expect(results.value).toEqual([])
    expect(total.value).toBeUndefined()
    expect(status.value).toBe('idle')
    expect(searchFn).toHaveBeenCalledTimes(1)
  })

  // Bug: clearing used to ride the debounce like any other input. VPSearchBox derives its idle
  // state from the query synchronously, so the stale results rendered next to the idle text for
  // the full debounce window.
  test('clearing takes effect on the watcher flush, before any debounce elapses', async () => {
    const searchFn = fake()
    const { query, results, total, status } = setup({
      adapter: { name: 'fake', search: searchFn },
    })

    await search(query, 'vue')
    expect(results.value).toHaveLength(1)

    query.value = ''
    await nextTick()
    expect(results.value).toEqual([])
    expect(total.value).toBeUndefined()
    expect(status.value).toBe('idle')
  })

  test('a whitespace-only query counts as empty', async () => {
    const searchFn = fake()
    const { query, status } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, '   ')
    expect(searchFn).not.toHaveBeenCalled()
    expect(status.value).toBe('idle')
  })
})

describe('staleness', () => {
  test('a late first response never clobbers a newer one', async () => {
    const first = deferred<SearchResponse>()
    const second = deferred<SearchResponse>()
    const searchFn = fake()
    searchFn
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { query, results, total, status } = setup({
      adapter: { name: 'fake', search: searchFn },
    })

    await search(query, 'a')
    await search(query, 'ab')
    expect(searchFn).toHaveBeenCalledTimes(2)

    second.resolve(response('/second'))
    await tick()
    expect(results.value.map((r) => r.url)).toEqual(['/second'])

    first.resolve(response('/first'))
    await tick()
    expect(results.value.map((r) => r.url)).toEqual(['/second'])
    expect(total.value).toEqual({ count: 1, exact: true })
    expect(status.value).toBe('done')
  })

  test('a late rejection cannot flip a settled search into the error state', async () => {
    const first = deferred<SearchResponse>()
    const searchFn = fake()
    searchFn.mockImplementationOnce(() => first.promise)
    const { query, results, status, error } = setup({
      adapter: { name: 'fake', search: searchFn },
    })

    await search(query, 'a')
    await search(query, 'ab')

    first.reject(new Error('too late'))
    await tick()
    expect(status.value).toBe('done')
    expect(error.value).toBeUndefined()
    expect(results.value.map((r) => r.url)).toEqual(['/ab'])
  })

  test('aborts the in-flight request when a new query supersedes it', async () => {
    const pending = deferred<SearchResponse>()
    const searchFn = fake()
    searchFn.mockImplementationOnce(() => pending.promise)
    const { query } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, 'a')
    expect(signalOf(searchFn, 0).aborted).toBe(false)

    await search(query, 'ab')
    expect(signalOf(searchFn, 0).aborted).toBe(true)
    expect(signalOf(searchFn, 1).aborted).toBe(false)
    // each run gets its own controller
    expect(signalOf(searchFn, 1)).not.toBe(signalOf(searchFn, 0))
  })

  test('an empty query also aborts what is in flight', async () => {
    const pending = deferred<SearchResponse>()
    const searchFn = fake(() => pending.promise)
    const { query } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, 'a')
    await search(query, '')
    expect(signalOf(searchFn, 0).aborted).toBe(true)
  })

  test('an AbortError from a superseded run is swallowed', async () => {
    const first = deferred<SearchResponse>()
    const searchFn = fake()
    searchFn.mockImplementationOnce(() => first.promise)
    const { query, results, status, error } = setup({
      adapter: { name: 'fake', search: searchFn },
    })

    await search(query, 'a')
    await search(query, 'ab')

    first.reject(new DOMException('aborted', 'AbortError'))
    await tick()
    expect(error.value).toBeUndefined()
    expect(status.value).toBe('done')
    expect(results.value.map((r) => r.url)).toEqual(['/ab'])
  })

  test('a superseded synchronous search runs anyway, and the counter drops it', async () => {
    // Why the generation counter exists next to the aborts: a sync adapter never looks at the
    // signal, so both runs answer — the newest must win.
    const gate = deferred<void>()
    const searchFn = fake((query) => response(`/${query}`))
    const { query, results, status } = setup({
      adapter: { name: 'sync', load: () => gate.promise, search: searchFn },
    })

    // the one-time `load` parks both runs, so they overlap the way an invalidation or a retry
    // overlaps them in the component
    await search(query, 'a')
    await search(query, 'ab')
    expect(searchFn).not.toHaveBeenCalled()

    const rendered: string[][] = []
    const stop = watch(results, (value) => rendered.push(value.map((r) => r.url)), {
      flush: 'sync',
    })
    gate.resolve()
    await tick()
    stop()

    expect(searchFn.mock.calls.map((call) => call[0])).toEqual(['a', 'ab'])
    expect(signalOf(searchFn, 0).aborted).toBe(true)
    // never even a flash of the first answer
    expect(rendered).toEqual([['/ab']])
    expect(status.value).toBe('done')
  })

  test('an AbortError from the current run is a failed search', async () => {
    // nothing superseded it, so the adapter aborted itself — its own timeout, say — and the user is
    // left with a query that produced nothing
    const load = vi.fn(async () => {})
    const searchFn = fake(() => Promise.reject(new DOMException('aborted', 'AbortError')))
    const { query, status, error, retry } = setup({
      adapter: { name: 'fake', load, search: searchFn },
    })

    await search(query, 'vue')
    expect(status.value).toBe('error')
    expect(error.value).toBeInstanceOf(DOMException)

    // the search aborted, not the load: retrying must not re-run the load
    retry()
    await tick(0)
    expect(load).toHaveBeenCalledTimes(1)
    expect(searchFn).toHaveBeenCalledTimes(2)
  })
})

describe('errors', () => {
  test('an adapter throw lands in `error` with status error', async () => {
    const boom = new Error('boom')
    const searchFn = fake(() => {
      throw boom
    })
    const { query, status, error } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, 'vue')
    expect(status.value).toBe('error')
    expect(error.value).toBe(boom)
  })

  test('a rejected promise is treated the same as a throw', async () => {
    const boom = new Error('boom')
    const searchFn = fake(() => Promise.reject(boom))
    const { query, status, error } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, 'vue')
    expect(status.value).toBe('error')
    expect(error.value).toBe(boom)
  })

  test('retry re-runs immediately, with no debounce to wait out', async () => {
    const boom = new Error('boom')
    const searchFn = fake()
    searchFn.mockImplementationOnce(() => {
      throw boom
    })
    const { query, status, retry } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, 'vue')
    expect(status.value).toBe('error')

    retry()
    await tick(0)
    expect(searchFn).toHaveBeenCalledTimes(2)
    expect(status.value).toBe('done')
  })

  test('a failure resets the memoized load, so retry runs it again', async () => {
    const load = vi.fn(async () => {})
    const searchFn = fake()
    searchFn.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const { query, status, retry } = setup({
      adapter: { name: 'fake', load, search: searchFn },
    })

    await search(query, 'vue')
    expect(load).toHaveBeenCalledTimes(1)
    expect(status.value).toBe('error')

    retry()
    await tick(0)
    expect(load).toHaveBeenCalledTimes(2)
    expect(status.value).toBe('done')
  })

  test('retry on an empty query just clears, without calling the adapter', async () => {
    const searchFn = fake()
    const { retry, status } = setup({ adapter: { name: 'fake', search: searchFn } })

    retry()
    await tick(0)
    expect(searchFn).not.toHaveBeenCalled()
    expect(status.value).toBe('idle')
  })
})

describe('load', () => {
  test('is awaited once and reused across searches', async () => {
    const gate = deferred<void>()
    const load = vi.fn(() => gate.promise)
    const searchFn = fake()
    const { query, status } = setup({ adapter: { name: 'fake', load, search: searchFn } })

    await search(query, 'a')
    expect(load).toHaveBeenCalledTimes(1)
    expect(searchFn).not.toHaveBeenCalled()
    expect(status.value).toBe('loading')

    gate.resolve()
    await tick()
    expect(searchFn).toHaveBeenCalledTimes(1)

    await search(query, 'ab')
    await search(query, 'abc')
    expect(load).toHaveBeenCalledTimes(1)
    expect(searchFn).toHaveBeenCalledTimes(3)
  })

  test('memoizes a load that returns void', async () => {
    // the adapter contract allows a synchronous `load`, which returns nothing a promise-shaped memo
    // could hold on to
    const load = vi.fn((): void => {})
    const { query } = setup({ adapter: { name: 'fake', load, search: fake() } })

    await search(query, 'a')
    await search(query, 'ab')
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('receives the same context object the search does', async () => {
    const load = vi.fn<(ctx: SearchContext) => Promise<void>>(async () => {})
    const searchFn = fake()
    const { query } = setup({
      adapter: { name: 'fake', load, search: searchFn },
      context: () => ({ localeIndex: 'zh', lang: 'zh-CN', limit: 12 }),
    })

    await search(query, 'vue')
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]?.[0]).toBe(searchFn.mock.calls[0]?.[1])
  })
})

describe('context', () => {
  test('is re-read on every run, so a locale switch reaches the adapter', async () => {
    const searchFn = fake()
    let localeIndex = 'root'
    const context = vi.fn(() => ({ localeIndex, limit: 12 }))
    const { query } = setup({ adapter: { name: 'fake', search: searchFn }, context })

    await search(query, 'a')
    expect(context).toHaveBeenCalledTimes(1)
    expect(searchFn.mock.calls[0]?.[1]).toMatchObject({ localeIndex: 'root', limit: 12 })

    localeIndex = 'zh'
    await search(query, 'ab')
    expect(context).toHaveBeenCalledTimes(2)
    expect(searchFn.mock.calls[1]?.[1]).toMatchObject({ localeIndex: 'zh', limit: 12 })
  })

  test('an absent context still hands the adapter a signal', async () => {
    const searchFn = fake()
    const { query } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, 'vue')
    expect(Object.keys(searchFn.mock.calls[0]?.[1] ?? {})).toEqual(['signal'])
  })
})

describe('onInvalidate', () => {
  test('re-runs the active query when a richer tier lands', async () => {
    let phase = 'titles'
    let notify: (() => void) | undefined
    const adapter: SearchAdapter = {
      name: 'fake',
      search: (query) => ({
        results: [{ url: '/a', title: [{ text: `${query}:${phase}` }] }],
        total: { count: phase === 'titles' ? 3 : 12, exact: true },
      }),
      onInvalidate(listener) {
        notify = listener
        return () => (notify = undefined)
      },
    }
    const { query, results, total } = setup({ adapter })

    await search(query, 'github')
    expect(total.value?.count).toBe(3)
    expect(results.value[0]?.title[0]?.text).toBe('github:titles')

    phase = 'content'
    notify?.()
    await tick()
    expect(total.value?.count).toBe(12)
    expect(results.value[0]?.title[0]?.text).toBe('github:content')
  })

  test('does nothing while the query is empty', async () => {
    let notify: (() => void) | undefined
    const searchFn = fake()
    setup({
      adapter: {
        name: 'fake',
        search: searchFn,
        onInvalidate(listener) {
          notify = listener
          return () => (notify = undefined)
        },
      },
    })

    notify?.()
    await tick()
    expect(searchFn).not.toHaveBeenCalled()
  })

  test('unsubscribes when the scope is disposed', async () => {
    const unsubscribe = vi.fn()
    const onInvalidate = vi.fn(() => unsubscribe)
    const { stop } = setup({
      adapter: { name: 'fake', search: fake(), onInvalidate },
    })

    expect(onInvalidate).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()

    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('scope disposal', () => {
  test('drops a pending debounce timer', async () => {
    const searchFn = fake()
    const { query, stop } = setup({ adapter: { name: 'fake', search: searchFn } })

    query.value = 'vue'
    await nextTick()
    await tick(100)
    stop()

    await tick(500)
    expect(searchFn).not.toHaveBeenCalled()
  })

  test('aborts the in-flight request', async () => {
    const pending = deferred<SearchResponse>()
    const searchFn = fake(() => pending.promise)
    const { query, stop } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, 'vue')
    expect(signalOf(searchFn, 0).aborted).toBe(false)

    stop()
    expect(signalOf(searchFn, 0).aborted).toBe(true)
  })

  test('outside a scope it still works, and registers no disposal hook', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const searchFn = fake()
    const { query, status } = useSearch({ adapter: { name: 'fake', search: searchFn } })

    query.value = 'vue'
    await nextTick()
    await tick(200)
    expect(status.value).toBe('done')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('status', () => {
  test('walks idle → loading → done', async () => {
    const pending = deferred<SearchResponse>()
    const searchFn = fake(() => pending.promise)
    const { query, status } = setup({ adapter: { name: 'fake', search: searchFn } })

    expect(status.value).toBe('idle')
    await search(query, 'vue')
    expect(status.value).toBe('loading')

    pending.resolve(response('/a'))
    await tick()
    expect(status.value).toBe('done')
  })

  test('a response without a total leaves total undefined', async () => {
    const searchFn = fake(() => ({ results: [] }))
    const { query, total, status } = setup({ adapter: { name: 'fake', search: searchFn } })

    await search(query, 'vue')
    expect(status.value).toBe('done')
    expect(total.value).toBeUndefined()
  })
})
