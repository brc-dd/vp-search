import { parseHTML } from 'linkedom'
import type { RecordKind } from './types.ts'

export interface Section {
  /** Heading id; empty for the page-level section. */
  anchor: string
  title: string
  titles: string[]
  text: string
  kind: RecordKind
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/**
 * The slice of the DOM contract the extractor walks. linkedom's own types assume the DOM lib
 * (`implements globalThis.Element`), which this node-side module deliberately does not load.
 */
interface NodeLike {
  nodeType: number
  nodeValue: string | null
  textContent: string | null
  childNodes: Iterable<NodeLike>
}

interface ElementLike extends NodeLike {
  tagName: string
  getAttribute(name: string): string | null
  classList: { contains(name: string): boolean }
}

/** Never contributes readable text. */
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template'])

/**
 * Boundaries that must not fuse words. Inline elements are deliberately absent: Shiki wraps every
 * code token in a `<span>`, so separating those would turn `foo(` into `foo (`.
 */
// prettier-ignore
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'details', 'dialog',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul'
])

const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
}

interface Draft {
  anchor: string
  title: string
  titles: string[]
  kind: RecordKind
  parts: string[]
}

/**
 * Splits a rendered page into one record per id-bearing heading, plus a page-level record for prose
 * before the first heading (and for pages with no headings at all — otherwise they index as
 * nothing).
 */
export function splitIntoSections(
  html: string,
  contentSelector: string,
  pageTitle: string,
  fallbackToBody = false,
): Section[] {
  const { document } = parseHTML(html)
  const root = document.querySelector(contentSelector) ?? (fallbackToBody ? document.body : null)
  if (!root) return []

  const sections: Section[] = []
  const stack: string[] = []
  let current: Draft = { anchor: '', title: pageTitle, titles: [], kind: 'page', parts: [] }

  const flush = () => {
    const text = normalize(current.parts.join(''))
    // A heading is worth indexing on its own; an empty page-level shell is not.
    if (current.kind === 'page' ? text : current.title || text) {
      const { anchor, title, titles, kind } = current
      sections.push({ anchor, title, titles, kind, text })
    }
  }

  const walk = (node: NodeLike) => {
    for (const child of node.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        current.parts.push(child.nodeValue ?? '')
        continue
      }
      if (child.nodeType !== ELEMENT_NODE) continue

      const el = child as ElementLike
      const tag = el.tagName.toLowerCase()
      if (SKIP_TAGS.has(tag)) continue

      const level = HEADING_LEVELS[tag]
      const id = level ? el.getAttribute('id') : null
      if (level && id) {
        flush()
        const title = headingText(el)
        current = {
          anchor: id,
          title,
          titles: stack.slice(0, level - 1).filter(Boolean),
          kind: 'heading',
          parts: [],
        }
        stack.length = level - 1
        stack[level - 1] = title
        // The heading's own text is the title, never body text.
        continue
      }

      const block = BLOCK_TAGS.has(tag)
      if (block) current.parts.push('\n')
      walk(el)
      if (block) current.parts.push('\n')
    }
  }

  walk(root)
  flush()
  return sections
}

function headingText(heading: ElementLike): string {
  const parts: string[] = []
  for (const child of heading.childNodes) {
    // The permalink `<a>` carries a zero-width space and an aria-label.
    if (
      child.nodeType === ELEMENT_NODE &&
      (child as ElementLike).classList?.contains('header-anchor')
    ) {
      continue
    }
    parts.push(child.textContent ?? '')
  }
  return normalize(parts.join(''))
}

function normalize(text: string): string {
  return text
    .replace(/\u200B/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
