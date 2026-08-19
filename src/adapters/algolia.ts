import { defineSearchAdapter, type SearchAdapter } from '../adapter.ts'
import { fromTagged, plain } from '../highlight.ts'
import type { MarkedText, SearchResult } from '../types.ts'

/** Sentinel highlight tags: can't occur in indexed text, no HTML involved. */
const PRE = '\u0002'
const POST = '\u0003'

type Level = 'lvl0' | 'lvl1' | 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'lvl6'
const LEVELS: Level[] = ['lvl0', 'lvl1', 'lvl2', 'lvl3', 'lvl4', 'lvl5', 'lvl6']

/** A DocSearch crawler record, as returned by the Algolia search API. */
export interface DocSearchHit {
  objectID: string
  url: string
  type: Level | 'content'
  content: string | null
  hierarchy: Partial<Record<Level, string | null>>
  _highlightResult?: {
    hierarchy?: Partial<Record<Level, { value: string }>>
  }
  _snippetResult?: { content?: { value: string } }
}

interface AlgoliaResponse {
  hits: DocSearchHit[]
  nbHits: number
  exhaustiveNbHits?: boolean
  processingTimeMS?: number
}

export interface AlgoliaAdapterOptions {
  appId: string
  /** Search-only API key. */
  apiKey: string
  indexName: string
  /** Extra request parameters, merged over the adapter's defaults. */
  searchParams?: Record<string, unknown>
}

/**
 * Queries a DocSearch-shaped Algolia index over the REST API with plain
 * `fetch` — no algoliasearch client, no DocSearch UI bundle.
 */
export function algoliaAdapter(options: AlgoliaAdapterOptions): SearchAdapter {
  const host = `https://${options.appId}-dsn.algolia.net`
  return defineSearchAdapter({
    name: 'algolia',
    attribution: { label: 'Algolia', url: 'https://www.algolia.com' },
    preconnect: [host],
    async search(query, ctx) {
      const res = await fetch(`${host}/1/indexes/${options.indexName}/query`, {
        method: 'POST',
        signal: ctx.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Algolia-Application-Id': options.appId,
          'X-Algolia-API-Key': options.apiKey,
        },
        body: JSON.stringify({
          query,
          hitsPerPage: ctx.limit ?? 20,
          highlightPreTag: PRE,
          highlightPostTag: POST,
          snippetEllipsisText: '…',
          attributesToRetrieve: ['hierarchy', 'content', 'type', 'url'],
          attributesToSnippet: ['content:15'],
          ...(ctx.lang && { facetFilters: [`lang:${ctx.lang}`] }),
          ...options.searchParams,
        }),
      })
      if (!res.ok) {
        throw new Error(`Algolia request failed: ${res.status} ${await res.text()}`)
      }
      const data: AlgoliaResponse = await res.json()
      return {
        results: data.hits.map(toResult),
        total: { count: data.nbHits, exact: data.exhaustiveNbHits ?? true },
        elapsedMs: data.processingTimeMS,
      }
    },
  })
}

function toResult(hit: DocSearchHit): SearchResult {
  const levels = LEVELS.filter((lvl) => hit.hierarchy[lvl] != null)
  const own = hit.type === 'content' ? levels.at(-1)! : hit.type
  const marked = (lvl: Level): MarkedText => {
    const highlighted = hit._highlightResult?.hierarchy?.[lvl]?.value
    return clean(highlighted ? fromTagged(highlighted, PRE, POST) : plain(hit.hierarchy[lvl] ?? ''))
  }
  return {
    id: hit.objectID,
    url: hit.url,
    title: marked(own),
    titles: levels.slice(0, levels.indexOf(own)).map(marked),
    excerpt: hit._snippetResult?.content?.value
      ? fromTagged(hit._snippetResult.content.value, PRE, POST)
      : undefined,
    group: hit.hierarchy.lvl0?.replaceAll('\u200B', '').trim(),
    kind: hit.type === 'content' ? 'content' : hit.type === 'lvl1' ? 'page' : 'heading',
    raw: hit,
  }
}

/** Crawled headings carry zero-width spaces from heading-anchor markup. */
function clean(text: MarkedText): MarkedText {
  const out = text
    .map((seg) => ({ ...seg, text: seg.text.replaceAll('\u200B', '') }))
    .filter((seg) => seg.text)
  const last = out.at(-1)
  if (last) last.text = last.text.trimEnd()
  return out.filter((seg) => seg.text)
}
