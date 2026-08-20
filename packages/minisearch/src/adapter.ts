import { defineSearchAdapter, type SearchAdapter, type SearchResponse } from '@vp-search/core'
import type { LocaleEntry, WorkerRequest, WorkerResponse } from './types.ts'

const TAG = '[vp-search]'

type ManifestFile = { locales?: Record<string, LocaleEntry> } & Record<string, unknown>

interface Deferred<T> {
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/**
 * Queries the build-time MiniSearch artifacts in a module worker: `load()`
 * resolves as soon as the titles tier answers, and the content tier upgrades
 * the same worker in the background.
 */
export function minisearchAdapter(): SearchAdapter {
  let worker: Worker | undefined
  let index: Promise<{ base: string; locales: Record<string, LocaleEntry> }> | undefined
  let started: Promise<void> | undefined
  let locale: string | undefined
  let titlesReady: Deferred<void> | undefined
  let nextId = 0
  const pending = new Map<number, Deferred<SearchResponse>>()
  const invalidateListeners = new Set<() => void>()

  function fail(error: unknown): void {
    titlesReady?.reject(error)
    titlesReady = undefined
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  function receive(message: WorkerResponse): void {
    if (message.type === 'tier') {
      if (message.tier === 'titles') {
        titlesReady?.resolve()
        titlesReady = undefined
      } else {
        for (const listener of invalidateListeners) listener()
      }
    } else if (message.type === 'results') {
      pending.get(message.id)?.resolve(message.response)
      pending.delete(message.id)
    } else if (message.id !== undefined) {
      pending.get(message.id)?.reject(new Error(message.message))
      pending.delete(message.id)
    } else if (titlesReady) {
      fail(new Error(message.message))
    } else {
      // Titles still answer searches; only full-text results are lost.
      console.warn(`${TAG} content index unavailable: ${message.message}`)
    }
  }

  function spawn(): Worker {
    const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    created.addEventListener('message', (event: MessageEvent<WorkerResponse>) =>
      receive(event.data),
    )
    created.addEventListener('error', (event) =>
      fail(new Error(event.message || `${TAG} search worker failed`)),
    )
    return created
  }

  function resolveIndex() {
    return (index ??= fetchIndex().catch((error: unknown) => {
      // The client retries `load()` after a failure; a memoized rejection
      // would make every retry replay it.
      index = undefined
      throw error
    }))
  }

  async function fetchIndex() {
    const data = (await import('virtual:vp-search/minisearch/manifest')).default
    if (!data) {
      throw new Error(`${TAG} no search index: the plugin is running another provider.`)
    }
    if (data.locales) return { base: data.base, locales: data.locales }
    // The build writes a `{ v, locales }` envelope; a bare record is tolerated.
    const file = await fetchJson<ManifestFile>(`${data.base}${data.manifest}`)
    return { base: data.base, locales: (file.locales ?? file) as Record<string, LocaleEntry> }
  }

  async function start(key: string): Promise<void> {
    // Set before the first await: concurrent searches must see this locale as
    // already starting rather than re-initializing the worker.
    locale = key
    const { base, locales } = await resolveIndex()
    const entry = locales[key] ?? locales['root']
    if (!entry) throw new Error(`${TAG} no search index for locale ${JSON.stringify(key)}`)
    const ready = new Promise<void>((resolve, reject) => {
      titlesReady = { resolve, reject }
    })
    ;(worker ??= spawn()).postMessage({
      type: 'init',
      base,
      locale: key,
      entry,
    } satisfies WorkerRequest)
    await ready
  }

  return defineSearchAdapter({
    name: 'minisearch',

    load(ctx) {
      return (started = start(ctx.localeIndex ?? 'root'))
    },

    async search(query, ctx) {
      const key = ctx.localeIndex ?? 'root'
      if (key !== locale) started = start(key)
      await started
      const id = nextId++
      return new Promise<SearchResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        // Aborted searches are dropped, not rejected: the client's generation
        // guard already ignores whatever a superseded query would return.
        ctx.signal?.addEventListener('abort', () => void pending.delete(id), { once: true })
        worker!.postMessage({
          type: 'search',
          id,
          query,
          ...(ctx.limit != null && { limit: ctx.limit }),
        } satisfies WorkerRequest)
      })
    },

    onInvalidate(listener) {
      invalidateListeners.add(listener)
      return () => invalidateListeners.delete(listener)
    },

    dispose() {
      worker?.postMessage({ type: 'dispose' } satisfies WorkerRequest)
      worker?.terminate()
      worker = undefined
      started = undefined
      locale = undefined
      titlesReady = undefined
      pending.clear()
    },
  })
}

/** The client factory `virtual:vp-search/adapter` instantiates. */
export default minisearchAdapter

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${TAG} ${response.status} ${response.statusText} for ${url}`)
  }
  return response.json() as Promise<T>
}
