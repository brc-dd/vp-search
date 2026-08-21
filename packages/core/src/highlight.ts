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
 * Parses text with matches wrapped in `preTag`/`postTag` (DESIGN §2). Ask the backend for sentinel
 * tags where possible, so indexed text can never collide with them.
 */
export function fromTagged(value: string, preTag: string, postTag: string): MarkedText {
  const out: TextSegment[] = []
  // empty runs are dropped and contiguous ones merged, so the UI renders one <mark> per run and
  // never an empty segment
  const push = (text: string, mark = false) => {
    if (!text) return
    const last = out.at(-1)
    if (last && !!last.mark === mark) last.text += text
    else if (mark) out.push({ text, mark: true })
    else out.push({ text })
  }
  let rest = value
  while (rest) {
    const start = rest.indexOf(preTag)
    // a post tag outside a marked run closes nothing; sentinel tags are control characters, so
    // leaving one in display text is never right
    if (start < 0) {
      push(rest.replaceAll(postTag, ''))
      break
    }
    push(rest.slice(0, start).replaceAll(postTag, ''))
    rest = rest.slice(start + preTag.length)
    const end = rest.indexOf(postTag)
    if (end < 0) {
      push(rest, true)
      break
    }
    push(rest.slice(0, end), true)
    rest = rest.slice(end + postTag.length)
  }
  return out
}

/** Character offsets, `end` exclusive; callers convert other conventions first (DESIGN §2). */
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
 * Decodes HTML entities in backend-escaped text (the DocSearch crawler, Pagefind excerpts).
 * Segments are plain text decoded once on ingest — the UI escapes at render.
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
 * Recomputes marks from matched terms, for backends with no positions (DESIGN §2). Longest-first,
 * so a short term can't shadow a longer one.
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
