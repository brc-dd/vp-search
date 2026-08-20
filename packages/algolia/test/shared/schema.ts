/**
 * Structural validation of the DocSearch record fields the adapter consumes.
 * Lives in the shared lane so it can be unit-tested hermetically; the live
 * lane runs it against real records to catch index/crawler drift.
 */

export const LEVELS = ['lvl0', 'lvl1', 'lvl2', 'lvl3', 'lvl4', 'lvl5', 'lvl6'] as const
export const TYPES = new Set<string>([...LEVELS, 'content'])

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Every way a hit can break the adapter, reported as `path: what went wrong`. */
export function drift(hits: Record<string, unknown>[]): string[] {
  const problems: string[] = []
  const bad = (path: string, message: string) => problems.push(`${path}: ${message}`)
  hits.forEach((hit, index) => {
    const at = `hits[${index}]`
    if (typeof hit['objectID'] !== 'string') bad(`${at}.objectID`, 'expected a string')
    if (typeof hit['url'] !== 'string') bad(`${at}.url`, 'expected a string')
    else if (!URL.canParse(hit['url'])) bad(`${at}.url`, `not a parseable URL: ${hit['url']}`)
    const type = hit['type']
    if (typeof type !== 'string' || !TYPES.has(type)) {
      bad(`${at}.type`, `expected one of lvl0..lvl6 | content, got ${JSON.stringify(type)}`)
    }
    if (hit['content'] !== null && typeof hit['content'] !== 'string') {
      bad(`${at}.content`, 'expected a string or null')
    }

    if (typeof hit['hierarchy'] !== 'object' || hit['hierarchy'] === null) {
      bad(`${at}.hierarchy`, 'expected an object')
      return
    }
    const levels = record(hit['hierarchy'])
    const present: string[] = []
    for (const level of LEVELS) {
      const value = levels[level]
      if (value === null || value === undefined) continue
      if (typeof value !== 'string') bad(`${at}.hierarchy.${level}`, 'expected a string or null')
      else present.push(level)
    }
    if (typeof levels['lvl0'] !== 'string') {
      bad(`${at}.hierarchy.lvl0`, 'expected a string — the adapter maps it to `group`')
    }
    if (!present.length) bad(`${at}.hierarchy`, 'every level is null, nothing to title with')
    if (typeof type === 'string' && type !== 'content' && !present.includes(type)) {
      bad(`${at}.hierarchy.${type}`, `null although the record has type ${type}`)
    }

    const highlighted = record(record(hit['_highlightResult'])['hierarchy'])
    for (const level of present) {
      if (typeof record(highlighted[level])['value'] !== 'string') {
        bad(`${at}._highlightResult.hierarchy.${level}.value`, 'expected a string')
      }
    }
    for (const level of Object.keys(highlighted)) {
      if (!present.includes(level)) {
        bad(`${at}._highlightResult.hierarchy.${level}`, 'highlighted a null hierarchy level')
      }
    }

    if (type === 'content') {
      if (typeof record(record(hit['_snippetResult'])['content'])['value'] !== 'string') {
        bad(`${at}._snippetResult.content.value`, 'expected a string on a content record')
      }
    }
  })
  return problems
}

/**
 * The paths the adapter reads, with level numbers collapsed to `lvlN` so that
 * two records of the same `type` at different depths still compare equal.
 */
export function consumedPaths(hit: Record<string, unknown>): string[] {
  const paths = new Set<string>()
  for (const key of ['objectID', 'url', 'type', 'content']) {
    if (hit[key] !== undefined) paths.add(key)
  }
  for (const [level, value] of Object.entries(record(hit['hierarchy']))) {
    if (value !== null) paths.add(`hierarchy.${level.replace(/\d$/, 'N')}`)
  }
  for (const level of Object.keys(record(record(hit['_highlightResult'])['hierarchy']))) {
    paths.add(`_highlightResult.hierarchy.${level.replace(/\d$/, 'N')}.value`)
  }
  if (record(record(hit['_snippetResult'])['content'])['value'] !== undefined) {
    paths.add('_snippetResult.content.value')
  }
  return [...paths].sort()
}
