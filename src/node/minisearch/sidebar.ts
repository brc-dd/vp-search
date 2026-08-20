import type { DefaultTheme } from 'vitepress'

type SidebarItem = DefaultTheme.SidebarItem

const EXTERNAL_URL_RE = /^(?:[a-z]+:|\/\/)/i
const HASH_OR_QUERY_RE = /[?#].*$/
const INDEX_OR_EXT_RE = /(?:(^|\/)index)?(?:\.(?:md|html))?$/
const TAG_RE = /<[^>]*>/g

/**
 * The sidebar section a page belongs to, used as the result `group`. Ported
 * from the default theme's `getSidebar`: multi-sidebar keys resolve
 * longest-prefix-first and per-item `base` rewrites links.
 */
export function resolveGroup(
  sidebar: DefaultTheme.Sidebar | undefined,
  relativePath: string,
): string | undefined {
  const items = getSidebar(sidebar, relativePath)
  if (!items.length) return
  const target = normalizePath(ensureStartingSlash(relativePath))
  for (const item of items) {
    // A bare top-level link is not a grouping; its label is the page's own.
    if (item.items?.length && contains(item, target)) return stripTags(item.text)
  }
}

function getSidebar(sidebar: DefaultTheme.Sidebar | undefined, path: string): SidebarItem[] {
  if (Array.isArray(sidebar)) return addBase(sidebar)
  if (sidebar == null) return []

  path = ensureStartingSlash(path)
  const dir = Object.keys(sidebar)
    .sort((a, b) => b.split('/').length - a.split('/').length)
    .find((key) => path.startsWith(ensureStartingSlash(key)))

  const matched = dir ? sidebar[dir] : []
  if (!matched) return []
  return Array.isArray(matched) ? addBase(matched) : addBase(matched.items, matched.base)
}

function addBase(items: SidebarItem[], _base?: string): SidebarItem[] {
  return items.map((_item) => {
    const item = { ..._item }
    const base = item.base || _base
    if (base && item.link && !EXTERNAL_URL_RE.test(item.link)) {
      item.link = base + item.link.replace(/^\//, base.endsWith('/') ? '' : '/')
    }
    if (item.items) item.items = addBase(item.items, base)
    return item
  })
}

function contains(item: SidebarItem, target: string): boolean {
  if (item.link && normalizePath(ensureStartingSlash(item.link)) === target) return true
  return item.items?.some((child) => contains(child, target)) ?? false
}

function ensureStartingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function normalizePath(path: string): string {
  let decoded = path
  try {
    decoded = decodeURI(path)
  } catch {}
  return decoded.replace(HASH_OR_QUERY_RE, '').replace(INDEX_OR_EXT_RE, '$1')
}

function stripTags(label: string | undefined): string | undefined {
  const text = label?.replace(TAG_RE, '').replace(/\s+/g, ' ').trim()
  return text || undefined
}
