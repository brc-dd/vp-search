import { describe, expect, test } from 'vitest'
import { capturedResponse } from './fixtures/docsearch-response.ts'
import { consumedPaths, drift } from './schema.ts'

/**
 * The live lane's drift detector, unit-tested against a known-good capture and deliberately broken
 * records — a schema guard that cannot fail is worthless.
 */

const GOOD: Record<string, unknown> = {
  objectID: '25-https://example.com/guide',
  url: 'https://example.com/guide#intro',
  type: 'lvl2',
  content: null,
  hierarchy: { lvl0: 'Guide', lvl1: 'Intro', lvl2: 'Install', lvl3: null },
  _highlightResult: {
    hierarchy: { lvl0: { value: 'Guide' }, lvl1: { value: 'Intro' }, lvl2: { value: 'Install' } },
  },
}

/** A shallow-merged copy — enough for one-field drift, no deep merge wanted. */
function broken(patch: Record<string, unknown>): Record<string, unknown>[] {
  return [{ ...GOOD, ...patch }]
}

describe('drift detection', () => {
  test('the checked-in capture passes clean', () => {
    const hits = capturedResponse().hits as unknown as Record<string, unknown>[]
    expect(drift(hits)).toEqual([])
  })

  test('a healthy synthetic record passes clean', () => {
    expect(drift([GOOD])).toEqual([])
  })

  test.for([
    [{ objectID: 42 }, 'hits[0].objectID: expected a string'],
    [{ url: null }, 'hits[0].url: expected a string'],
    [{ url: '/guide#intro' }, 'hits[0].url: not a parseable URL: /guide#intro'],
    [{ type: 'lvl7' }, 'hits[0].type: expected one of lvl0..lvl6 | content, got "lvl7"'],
    [{ content: 12 }, 'hits[0].content: expected a string or null'],
    [{ hierarchy: 'Guide > Intro' }, 'hits[0].hierarchy: expected an object'],
  ] as [Record<string, unknown>, string][])('names the field for %o', ([patch, message]) => {
    expect(drift(broken(patch))).toContain(message)
  })

  test('names a hierarchy level that stopped being a string', () => {
    expect(
      drift(broken({ hierarchy: { lvl0: 'Guide', lvl1: 'Intro', lvl2: ['Install'] } })),
    ).toContain('hits[0].hierarchy.lvl2: expected a string or null')
  })

  test('names lvl0 when it goes null, since group depends on it', () => {
    expect(drift(broken({ hierarchy: { lvl0: null, lvl1: 'Intro', lvl2: 'Install' } }))).toContain(
      'hits[0].hierarchy.lvl0: expected a string — the adapter maps it to `group`',
    )
  })

  test('names the level a record claims as its type but leaves null', () => {
    expect(drift(broken({ hierarchy: { lvl0: 'Guide', lvl1: 'Intro', lvl2: null } }))).toContain(
      'hits[0].hierarchy.lvl2: null although the record has type lvl2',
    )
  })

  test('reports a hierarchy with nothing to title from', () => {
    expect(drift(broken({ type: 'content', hierarchy: {} }))).toContain(
      'hits[0].hierarchy: every level is null, nothing to title with',
    )
  })

  test('names a highlight level that lost its value string', () => {
    expect(
      drift(
        broken({
          _highlightResult: {
            hierarchy: { lvl0: { value: 'Guide' }, lvl1: { value: 'Intro' }, lvl2: {} },
          },
        }),
      ),
    ).toContain('hits[0]._highlightResult.hierarchy.lvl2.value: expected a string')
  })

  test('notices a whole missing _highlightResult', () => {
    expect(drift(broken({ _highlightResult: undefined }))).toEqual([
      'hits[0]._highlightResult.hierarchy.lvl0.value: expected a string',
      'hits[0]._highlightResult.hierarchy.lvl1.value: expected a string',
      'hits[0]._highlightResult.hierarchy.lvl2.value: expected a string',
    ])
  })

  test('notices a highlight for a level the hierarchy says is null', () => {
    expect(
      drift(
        broken({
          _highlightResult: {
            hierarchy: {
              lvl0: { value: 'Guide' },
              lvl1: { value: 'Intro' },
              lvl2: { value: 'Install' },
              lvl3: { value: 'Ghost' },
            },
          },
        }),
      ),
    ).toContain('hits[0]._highlightResult.hierarchy.lvl3: highlighted a null hierarchy level')
  })

  test('requires a snippet only on content records', () => {
    expect(drift(broken({ type: 'content' }))).toContain(
      'hits[0]._snippetResult.content.value: expected a string on a content record',
    )
    expect(drift([GOOD])).toEqual([])
  })

  test('reports the index of the hit that drifted', () => {
    expect(drift([GOOD, { ...GOOD, objectID: 7 }])).toEqual(['hits[1].objectID: expected a string'])
  })
})

describe('consumed paths', () => {
  test('collapses level numbers so ranking cannot move a path', () => {
    expect(consumedPaths(GOOD)).toEqual([
      '_highlightResult.hierarchy.lvlN.value',
      'content',
      'hierarchy.lvlN',
      'objectID',
      'type',
      'url',
    ])
  })

  test('a content record adds the snippet path', () => {
    const hits = capturedResponse().hits as unknown as Record<string, unknown>[]
    const content = hits.find((hit) => hit['type'] === 'content')
    expect(consumedPaths(content ?? {})).toContain('_snippetResult.content.value')
  })

  test('two captured hits of the same type agree on their paths', () => {
    const hits = capturedResponse().hits as unknown as Record<string, unknown>[]
    const pages = hits.filter((hit) => hit['type'] === 'lvl1').map(consumedPaths)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toEqual(pages[1])
  })

  test('a dropped _snippetResult changes the path set', () => {
    const hits = capturedResponse().hits as unknown as Record<string, unknown>[]
    const content = hits.find((hit) => hit['type'] === 'content') ?? {}
    const { _snippetResult: _dropped, ...without } = content
    expect(consumedPaths(without)).not.toEqual(consumedPaths(content))
  })
})
