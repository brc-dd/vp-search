import type { MarkedText, TextSegment } from './types.ts'

export function plain(text: string): MarkedText {
  return text ? [{ text }] : []
}

export function textOf(text: MarkedText): string {
  let out = ''
  for (const seg of text) out += seg.text
  return out
}

/**
 * Parse backend-highlighted text where matches are wrapped in known tags
 * (Algolia/Meilisearch `highlightPreTag`/`highlightPostTag`, Typesense
 * `highlight_start_tag`, Pagefind `<mark>`). Ask the backend for sentinel
 * tags where possible so indexed text can never collide with them.
 */
export function fromTagged(value: string, preTag: string, postTag: string): MarkedText {
  const out: TextSegment[] = []
  let rest = value
  while (rest) {
    const start = rest.indexOf(preTag)
    if (start < 0) {
      out.push({ text: rest })
      break
    }
    if (start > 0) out.push({ text: rest.slice(0, start) })
    rest = rest.slice(start + preTag.length)
    const end = rest.indexOf(postTag)
    const last = start === 0 ? out.at(-1) : undefined
    if (end < 0) {
      if (last?.mark) last.text += rest
      else out.push({ text: rest, mark: true })
      break
    }
    if (end > 0) {
      if (last?.mark) last.text += rest.slice(0, end)
      else out.push({ text: rest.slice(0, end), mark: true })
    }
    rest = rest.slice(end + postTag.length)
  }
  return out
}

/**
 * Character offsets, `end` exclusive. Backends with other conventions must be
 * converted first: Fuse.js and @orama/highlight report INCLUSIVE ends (+1),
 * Lunr reports [start, length], Meilisearch reports UTF-8 BYTE offsets,
 * Pagefind reports word indices.
 */
export interface HighlightRange {
  start: number
  end: number
}

export function fromRanges(text: string, ranges: HighlightRange[]): MarkedText {
  const out: TextSegment[] = []
  let cursor = 0
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const start = Math.max(range.start, cursor)
    const end = Math.min(range.end, text.length)
    if (end <= start) continue
    if (start > cursor) out.push({ text: text.slice(cursor, start) })
    const last = out.at(-1)
    // contiguous marks merge so the UI renders one <mark>, not touching pairs
    if (last?.mark && start === cursor) last.text += text.slice(start, end)
    else out.push({ text: text.slice(start, end), mark: true })
    cursor = end
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) })
  return out
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
}

/**
 * For backends whose stored/highlighted text is HTML-entity-escaped (the
 * DocSearch crawler, Pagefind excerpts). Segments are plain text — the UI
 * escapes at render — so entities must be decoded exactly once on ingest.
 */
export function unescapeEntities(text: string): string {
  return text.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X'
      const point = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return match
      return String.fromCodePoint(point)
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match
  })
}

/**
 * Recompute marks from matched terms, for backends that report no positions
 * (MiniSearch, FlexSearch). Longest-first so a short term can't shadow a
 * longer one — same trick as VitePress's local search.
 */
export function fromTerms(text: string, terms: readonly string[]): MarkedText {
  const escaped = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!escaped.length) return plain(text)
  const ranges: HighlightRange[] = []
  for (const m of text.matchAll(new RegExp(escaped.join('|'), 'gi'))) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  return fromRanges(text, ranges)
}
