/**
 * Artifact server + fetch gate for the worker lane. The gate can hold a URL
 * open until the test releases it, which is what makes the tier-ordering and
 * superseded-init races deterministic instead of timing-dependent.
 */

import type { SearchResponse } from '@vp-search/core'
import MiniSearch from 'minisearch'
import {
  CONTENT_FIELDS,
  CONTENT_STORE_FIELDS,
  TITLES_FIELDS,
  TITLES_STORE_FIELDS,
} from '../../src/fields.ts'
import { createTokenizer } from '../../src/tokenize.ts'
import type { Artifact, IndexRecord, LocaleEntry, WorkerResponse } from '../../src/types.ts'

export const EN: IndexRecord[] = [
  {
    id: '/guide.html',
    title: 'Guide',
    titles: [],
    text: 'Install the docs toolchain first.',
    kind: 'page',
  },
  {
    id: '/config.html',
    title: 'Config',
    titles: ['Reference'],
    text: 'Every docs site has one config file.',
    kind: 'page',
  },
]

export const ZH: IndexRecord[] = [
  { id: '/zh/guide.html', title: '指南', titles: [], text: '安装 docs 工具链。', kind: 'page' },
]

/** Built from the indexer's own field split, so a tier change reaches here. */
function artifact(lang: string, records: IndexRecord[], tier: 'titles' | 'content'): Artifact {
  const fields = tier === 'titles' ? [...TITLES_FIELDS] : [...CONTENT_FIELDS]
  const storeFields = tier === 'titles' ? [...TITLES_STORE_FIELDS] : [...CONTENT_STORE_FIELDS]
  const engine = new MiniSearch<IndexRecord>({
    fields,
    storeFields,
    idField: 'id',
    tokenize: createTokenizer(lang),
  })
  engine.addAll(records)
  return { v: 1, lang, options: { fields, storeFields }, index: JSON.stringify(engine) }
}

/** Every artifact the tests can serve, keyed by the URL the worker will build. */
export function artifactFiles(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['/vp-search/root.titles.json', artifact('en-US', EN, 'titles')],
    ['/vp-search/root.content.json', artifact('en-US', EN, 'content')],
    ['/vp-search/zh.titles.json', artifact('zh-CN', ZH, 'titles')],
    ['/vp-search/zh.content.json', artifact('zh-CN', ZH, 'content')],
  ])
}

export const entryFor = (locale: string): LocaleEntry => ({
  lang: locale === 'zh' ? 'zh-CN' : 'en-US',
  titles: `vp-search/${locale}.titles.json`,
  content: `vp-search/${locale}.content.json`,
  sections: locale === 'zh' ? 1 : 2,
})

export interface FetchGate {
  /** Stub for `globalThis.fetch`; serves `files`, 404s anything else. */
  fetch: (input: string | URL) => Promise<unknown>
  files: Map<string, unknown>
  /** Every URL requested, in order. */
  calls: string[]
  /** Requests for `url` block until `release(url)`. */
  hold(url: string): void
  release(url: string): void
  /** Serve `url` with a body that fails to parse as JSON. */
  corrupt(url: string): void
}

export function createFetchGate(files = artifactFiles()): FetchGate {
  const held = new Set<string>()
  const pending = new Map<string, () => void>()
  const corrupted = new Set<string>()
  const calls: string[] = []

  return {
    files,
    calls,
    hold: (url) => void held.add(url),
    release(url) {
      held.delete(url)
      pending.get(url)?.()
      pending.delete(url)
    },
    corrupt: (url) => void corrupted.add(url),
    async fetch(input) {
      const url = String(input)
      calls.push(url)
      const body = files.get(url)
      if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found' }
      if (held.has(url)) await new Promise<void>((resolve) => pending.set(url, resolve))
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          if (corrupted.has(url)) throw new SyntaxError(`Unexpected token < in JSON: ${url}`)
          return body
        },
      }
    },
  }
}

/** One macrotask, which drains every pending microtask behind an await. */
export const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 20)
  })

export function resultsOf(message: WorkerResponse | undefined): SearchResponse {
  if (message?.type !== 'results') {
    throw new Error(`expected a results message, got ${JSON.stringify(message)}`)
  }
  return message.response
}

export function errorOf(message: WorkerResponse | undefined): string {
  if (message?.type !== 'error') {
    throw new Error(`expected an error message, got ${JSON.stringify(message)}`)
  }
  return message.message
}
