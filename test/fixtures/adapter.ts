import { defineSearchAdapter, type SearchAdapter } from '../../packages/core/src/adapter.ts'
import { fromTerms, plain } from '../../packages/core/src/highlight.ts'
import type { ResultKind, SearchResponse, SearchResult } from '../../packages/core/src/types.ts'

/**
 * Stand-in for `virtual:vp-search/adapter`, which exports an already-constructed adapter (core's
 * node plugin emits `export default create(options)`).
 */

export interface FixtureDoc {
  url: string
  title: string
  titles?: string[]
  text?: string
  group?: string
  kind?: ResultKind
}

function defaults(): FixtureDoc[] {
  return [
    {
      url: '/guide.html#install',
      title: 'Install',
      titles: ['Guide'],
      text: 'Install the plugin.',
    },
    { url: '/guide.html#usage', title: 'Usage', titles: ['Guide'], text: 'Usage of the plugin.' },
    { url: '/api.html', title: 'API', text: 'The adapter contract.' },
  ]
}

let docs: FixtureDoc[] = defaults()

let failure: unknown
const listeners = new Set<() => void>()

function toResult(doc: FixtureDoc, terms: string[]): SearchResult {
  return {
    url: doc.url,
    title: fromTerms(doc.title, terms),
    ...(doc.titles && { titles: doc.titles.map((t) => plain(t)) }),
    ...(doc.text && { excerpt: fromTerms(doc.text, terms) }),
    ...(doc.group !== undefined && { group: doc.group }),
    ...(doc.kind !== undefined && { kind: doc.kind }),
    raw: doc,
  }
}

const adapter: SearchAdapter = defineSearchAdapter({
  name: 'fixture',
  attribution: { label: 'Fixture', url: 'https://example.com' },

  search(query): SearchResponse {
    if (failure !== undefined) throw failure
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const hits = docs.filter((doc) =>
      terms.every((term) => `${doc.title} ${doc.text ?? ''}`.toLowerCase().includes(term)),
    )
    return {
      results: hits.map((doc) => toResult(doc, terms)),
      total: { count: hits.length, exact: true },
    }
  },

  onInvalidate(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
})

export default adapter

export function __setDocs(next: FixtureDoc[]): void {
  docs = next
}

/** Set to make every `search()` throw; `undefined` clears it. */
export function __setError(error: unknown): void {
  failure = error
}

export function __invalidate(): void {
  for (const listener of listeners) listener()
}

export function __reset(): void {
  docs = defaults()
  failure = undefined
  listeners.clear()
}
