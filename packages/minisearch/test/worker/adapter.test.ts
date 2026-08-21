import type { SearchAdapter, SearchContext, SearchResponse } from '@vp-search/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setBuildShape, __setData } from '../../../../test/fixtures/manifest.ts'
import { minisearchAdapter } from '../../src/adapter.ts'
import { createFetchGate, entryFor, settle, type FetchGate } from './helpers.ts'

const ROOT_TITLES = '/vp-search/root.titles.json'
const ROOT_CONTENT = '/vp-search/root.content.json'
const MANIFEST = '/vp-search/manifest.json'

/**
 * Captured at module scope, before any `vi.stubGlobal`, so it wraps `@vitest/web-worker`'s real
 * constructor rather than itself.
 */
const spawns: SpyWorker[] = []

class SpyWorker extends Worker {
  terminated = false

  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options)
    spawns.push(this)
  }

  override terminate(): void {
    this.terminated = true
    super.terminate()
  }
}

let gate: FetchGate
let adapter: SearchAdapter

const load = (ctx: SearchContext = {}): Promise<void> => {
  if (!adapter.load) throw new Error('adapter has no load()')
  return Promise.resolve(adapter.load(ctx))
}

const search = (query: string, ctx: SearchContext = {}): Promise<SearchResponse> =>
  Promise.resolve(adapter.search(query, ctx))

const onInvalidate = (listener: () => void): (() => void) => {
  if (!adapter.onInvalidate) throw new Error('adapter has no onInvalidate()')
  return adapter.onInvalidate(listener)
}

/** `load()` resolves on the titles tier; body-text queries need content too. */
async function loadWithContent(ctx: SearchContext = {}): Promise<void> {
  const content = new Promise<void>((resolve) => void onInvalidate(resolve))
  await load(ctx)
  await content
}

beforeEach(() => {
  spawns.length = 0
  gate = createFetchGate()
  vi.stubGlobal('fetch', gate.fetch)
  vi.stubGlobal('Worker', SpyWorker)
  __setData({ base: '/', locales: { root: entryFor('root'), zh: entryFor('zh') }, manifest: null })
  adapter = minisearchAdapter()
})

afterEach(() => {
  adapter.dispose?.()
  for (const worker of spawns) worker.terminate()
})

describe('identity', () => {
  it('names itself after the engine', () => {
    expect(adapter.name).toBe('minisearch')
  })
})

describe('load', () => {
  it('spawns a worker, inits it, and resolves once the titles tier is ready', async () => {
    await load()
    expect(spawns).toHaveLength(1)
    expect(gate.calls[0]).toBe(ROOT_TITLES)
  })

  it('resolves before the content tier lands', async () => {
    gate.hold(ROOT_CONTENT)
    await load()

    expect((await search('guide')).results).toHaveLength(1)
    // body text is only in the content tier, which is still in flight
    expect((await search('docs')).results).toEqual([])
  })

  it('does not double-spawn when load is called again', async () => {
    await load()
    await load()
    expect(spawns).toHaveLength(1)
  })

  it('falls back to the root entry for an unknown locale', async () => {
    await load({ localeIndex: 'de' })
    expect(gate.calls[0]).toBe(ROOT_TITLES)
  })

  it('rejects when no entry and no root entry exist', async () => {
    __setData({ base: '/', locales: { zh: entryFor('zh') }, manifest: null })
    await expect(load({ localeIndex: 'de' })).rejects.toThrow(/no search index for locale "de"/)
  })

  it('rejects when the plugin is running another provider', async () => {
    __setData(null)
    await expect(load()).rejects.toThrow(/the plugin is running another provider/)
  })

  it('rejects with the worker error when the titles artifact is missing', async () => {
    gate.files.delete(ROOT_TITLES)
    await expect(load()).rejects.toThrow(/404 Not Found for \/vp-search\/root\.titles\.json/)
  })

  it('warns instead of rejecting when only the content artifact fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    gate.files.delete(ROOT_CONTENT)

    await expect(load()).resolves.toBeUndefined()
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('content index unavailable'))
    })
    // titles still answer
    expect((await search('guide')).results).toHaveLength(1)
    warn.mockRestore()
  })
})

describe('manifest shapes', () => {
  // The indexer writes a bare `Record<locale, entry>`; the `{ v, locales }`
  // envelope is the tolerated alternative, not the emitted one.
  it('tolerates a { v, locales } envelope around the locale record', async () => {
    __setBuildShape()
    gate.files.set(MANIFEST, { v: 1, locales: { root: entryFor('root') } })

    await load()
    expect(gate.calls[0]).toBe(MANIFEST)
    expect(gate.calls[1]).toBe(ROOT_TITLES)
  })

  it('reads the bare locale record the build writes, when locales is null', async () => {
    __setBuildShape()
    gate.files.set(MANIFEST, { root: entryFor('root') })

    await expect(load()).resolves.toBeUndefined()
    expect(gate.calls[0]).toBe(MANIFEST)
    expect(gate.calls[1]).toBe(ROOT_TITLES)
  })

  it('does not memoize a failed manifest fetch, so a retry can succeed', async () => {
    __setBuildShape()
    await expect(load()).rejects.toThrow(/404 Not Found for \/vp-search\/manifest\.json/)

    gate.files.set(MANIFEST, { root: entryFor('root') })
    await expect(load()).resolves.toBeUndefined()
  })
})

describe('search', () => {
  it('resolves with a full SearchResponse', async () => {
    await loadWithContent()
    const response = await search('docs')

    expect(response.total).toEqual({ count: 2, exact: true })
    expect(response.elapsedMs).toBeTypeOf('number')
    expect(response.results.map((result) => result.url).sort()).toEqual([
      '/config.html',
      '/guide.html',
    ])
    expect(response.results[0]?.excerpt).toBeDefined()
  })

  it('honours the context limit without capping the total', async () => {
    await loadWithContent()
    const response = await search('docs', { limit: 1 })

    expect(response.results).toHaveLength(1)
    expect(response.total?.count).toBe(2)
  })

  it('starts the adapter itself when load was never called', async () => {
    expect((await search('guide')).results[0]?.url).toBe('/guide.html')
    expect(spawns).toHaveLength(1)
  })

  it('keeps concurrent searches correlated to their own queries', async () => {
    await load()
    // The shim delivers worker messages synchronously, so genuine out-of-order
    // delivery only exists in a real worker; id correlation itself is asserted
    // against the protocol in protocol.test.ts.
    const [guide, config] = await Promise.all([search('guide'), search('config')])

    expect(guide.results[0]?.url).toBe('/guide.html')
    expect(config.results[0]?.url).toBe('/config.html')
  })

  it('does not reject an aborted query', async () => {
    await load()
    const controller = new AbortController()
    const pending = search('guide', { signal: controller.signal })
    controller.abort()

    await expect(pending).resolves.toBeDefined()
  })

  it('re-inits for a locale switch and answers from the new locale', async () => {
    await load()
    expect((await search('指南', { localeIndex: 'zh' })).results[0]?.url).toBe('/zh/guide.html')
    // same worker, re-inited rather than replaced
    expect(spawns).toHaveLength(1)
    expect(gate.calls).toContain('/vp-search/zh.titles.json')
  })

  it('stops matching the previous locale after the switch', async () => {
    await load()
    await search('指南', { localeIndex: 'zh' })
    expect((await search('guide', { localeIndex: 'zh' })).results).toEqual([])
  })
})

describe('onInvalidate', () => {
  it('fires when the content tier lands', async () => {
    gate.hold(ROOT_CONTENT)
    const listener = vi.fn()
    onInvalidate(listener)

    await load()
    expect(listener).not.toHaveBeenCalled()

    gate.release(ROOT_CONTENT)
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  it('stops firing after the returned unsubscribe runs', async () => {
    gate.hold(ROOT_CONTENT)
    const listener = vi.fn()
    onInvalidate(listener)()

    await load()
    gate.release(ROOT_CONTENT)
    await settle()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('dispose', () => {
  it('terminates the worker', async () => {
    await load()
    adapter.dispose?.()

    expect(spawns[0]?.terminated).toBe(true)
  })

  it('clears state so a later search spawns a fresh worker', async () => {
    await load()
    adapter.dispose?.()

    expect((await search('guide')).results[0]?.url).toBe('/guide.html')
    expect(spawns).toHaveLength(2)
  })
})
