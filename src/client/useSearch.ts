import { getCurrentScope, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { SearchAdapter } from '../adapter.ts'
import type { SearchContext, SearchResult, SearchTotal } from '../types.ts'

export interface UseSearchOptions {
  adapter: SearchAdapter
  /** Per-query context (locale, lang, limit); re-read on every search. */
  context?: () => Omit<SearchContext, 'signal'>
  debounce?: number
}

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error'

/**
 * Client wiring shared by any UI: debounce, adapter lazy-load memoization,
 * in-flight aborts, and stale-response dropping via a generation counter
 * (needed as well as aborts — sync adapters can't be aborted).
 */
export function useSearch(options: UseSearchOptions) {
  const query = ref('')
  const results = shallowRef<SearchResult[]>([])
  const total = shallowRef<SearchTotal>()
  const status = ref<SearchStatus>('idle')
  const error = shallowRef<unknown>()

  let generation = 0
  let controller: AbortController | undefined
  let loading: Promise<void> | void
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(query, (value) => {
    clearTimeout(timer)
    timer = setTimeout(run, options.debounce ?? 200, value.trim())
  })

  async function run(q: string) {
    const gen = ++generation
    controller?.abort()
    if (!q) {
      results.value = []
      total.value = undefined
      status.value = 'idle'
      return
    }
    controller = new AbortController()
    status.value = 'loading'
    try {
      const ctx: SearchContext = {
        ...options.context?.(),
        signal: controller.signal,
      }
      await (loading ??= options.adapter.load?.(ctx))
      const response = await options.adapter.search(q, ctx)
      if (gen !== generation) return
      results.value = response.results
      total.value = response.total
      status.value = 'done'
    } catch (e) {
      if (gen !== generation) return
      if (e instanceof DOMException && e.name === 'AbortError') return
      loading = undefined
      error.value = e
      status.value = 'error'
    }
  }

  /** Re-runs the current query immediately; `load` is retried too after a failure. */
  function retry() {
    clearTimeout(timer)
    run(query.value.trim())
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      clearTimeout(timer)
      controller?.abort()
    })
  }

  return { query, results, total, status, error, retry }
}
