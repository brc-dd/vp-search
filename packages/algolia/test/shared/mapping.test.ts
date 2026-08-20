import { textOf, type SearchResult } from '@vp-search/core'
import { describe, expect, test } from 'vitest'
import type { DocSearchHit } from '../../src/adapter.ts'
import { capturedResponse, HIT } from './fixtures/docsearch-response.ts'
import { makeAdapter, POST, PRE, stubJson, ZWSP } from './helpers.ts'

/** Runs the adapter over a response body and returns the mapped results. */
async function mapHits(hits: DocSearchHit[]): Promise<SearchResult[]> {
  stubJson({ hits, nbHits: hits.length, exhaustiveNbHits: true })
  const { results } = await makeAdapter().search('markdown vue config anchors', {})
  return results
}

async function mapCaptured(): Promise<SearchResult[]> {
  return mapHits(capturedResponse().hits)
}

function at(results: SearchResult[], index: number): SearchResult {
  const result = results[index]
  if (!result) throw new Error(`no result at index ${index}`)
  return result
}

describe('captured DocSearch response', () => {
  test('maps every hit, in response order', async () => {
    const results = await mapCaptured()
    expect(results).toHaveLength(6)
    expect(results.map((r) => r.id)).toEqual(capturedResponse().hits.map((h) => h.objectID))
  })

  test('url passes through untouched, anchor included', async () => {
    const results = await mapCaptured()
    expect(at(results, HIT.page).url).toBe(
      'https://vitepress.dev/guide/using-vue#using-vue-in-markdown',
    )
    expect(results.every((r) => r.url.startsWith('https://vitepress.dev/'))).toBe(true)
  })

  test('kind maps lvl1 to page, lvl2-6 to heading, content to content', async () => {
    const results = await mapCaptured()
    expect(results.map((r) => r.kind)).toEqual([
      'page',
      'heading',
      'heading',
      'content',
      'heading',
      'page',
    ])
  })

  test('title comes from the hit own level, highlighted', async () => {
    const results = await mapCaptured()
    expect(at(results, HIT.page).title).toMatchInlineSnapshot(
      `Using <mark>Vue</mark> in <mark>Markdown</mark>`,
    )
    expect(at(results, HIT.heading).title).toMatchInlineSnapshot(`Header <mark>Anchors</mark>`)
  })

  test('a content hit titles itself with the deepest populated level', async () => {
    const results = await mapCaptured()
    const content = at(results, HIT.content)
    // hierarchy is lvl0..lvl3; own level is lvl3 = "markdown"
    expect(textOf(content.title)).toBe('markdown')
    expect(content.title).toMatchInlineSnapshot(`<mark>markdown</mark>`)
  })

  test('titles are the ancestors, root-first, with the own level excluded', async () => {
    const results = await mapCaptured()
    expect(at(results, HIT.deepHeading).titles?.map(textOf)).toEqual([
      'Reference',
      'Site Config',
      'Overview',
    ])
    expect(at(results, HIT.content).titles?.map(textOf)).toEqual([
      'Reference',
      'Site Config',
      'Customization',
    ])
  })

  test('marks inside ancestor crumbs survive the mapping', async () => {
    const results = await mapCaptured()
    // DESIGN §2: backends highlight breadcrumbs too, confirmed live
    expect(at(results, HIT.deepHeading).titles?.[1]).toMatchInlineSnapshot(
      `Site <mark>Config</mark>`,
    )
    expect(at(results, HIT.heading).titles?.[1]).toMatchInlineSnapshot(
      `<mark>Markdown</mark> Extensions`,
    )
  })

  test('null hierarchy levels are omitted from titles', async () => {
    const results = await mapCaptured()
    // lvl2..lvl6 are explicit nulls on this hit
    expect(at(results, HIT.page).titles?.map(textOf)).toEqual(['Writing'])
    expect(at(results, HIT.cjk).titles).toHaveLength(1)
  })

  test('excerpt comes from _snippetResult.content, ellipsis and marks intact', async () => {
    const results = await mapCaptured()
    expect(at(results, HIT.content).excerpt).toMatchInlineSnapshot(
      `Set <mark>markdown</mark>.headers to true or pass @mdit-<mark>vue</mark>/plugin-headers options to collect headings …`,
    )
  })

  test('hits without a snippet have no excerpt key at all', async () => {
    const results = await mapCaptured()
    // exactOptionalPropertyTypes: the key must be absent, not present-undefined
    expect('excerpt' in at(results, HIT.page)).toBe(false)
    expect('excerpt' in at(results, HIT.content)).toBe(true)
  })

  test('group is lvl0 as plain text', async () => {
    const results = await mapCaptured()
    expect(results.map((r) => r.group)).toEqual([
      'Writing',
      'Writing',
      'Reference',
      'Reference',
      '執筆',
      '写作',
    ])
  })

  test('entity-escaped crawler text is decoded exactly once', async () => {
    const results = await mapCaptured()
    expect(textOf(at(results, HIT.deepHeading).title)).toBe('Vite, Vue & Markdown Config')
    expect(textOf(at(results, HIT.escaped).title)).toBe('<script> と <style>')
  })

  test('no entity sequence survives anywhere in the output text', async () => {
    for (const text of allText(await mapCaptured())) {
      expect(text, `entity left undecoded in ${JSON.stringify(text)}`).not.toMatch(
        /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/i,
      )
    }
  })

  test('zero-width spaces from heading anchors are stripped', async () => {
    const captured = capturedResponse()
    // every lvl1+ value in the capture carries one, so this is a real check
    expect(JSON.stringify(captured).includes(ZWSP)).toBe(true)
    for (const text of allText(await mapCaptured())) {
      expect(text, `zero-width space left in ${JSON.stringify(text)}`).not.toContain(ZWSP)
    }
  })

  test('the trailing whitespace left behind by the stripped ZWSP is trimmed', async () => {
    const results = await mapCaptured()
    for (const text of allText(results)) expect(text).toBe(text.trimEnd())
  })

  test('no sentinel tag leaks into the output text', async () => {
    const results = await mapCaptured()
    for (const text of allText(results)) {
      expect(text).not.toContain(PRE)
      expect(text).not.toContain(POST)
    }
  })

  test('marks land on the query terms, CJK titles included', async () => {
    const results = await mapCaptured()
    expect(at(results, HIT.cjk).title).toMatchInlineSnapshot(
      `在 <mark>Markdown</mark> 中使用 <mark>Vue</mark>`,
    )
    expect(
      at(results, HIT.cjk)
        .title.filter((seg) => seg.mark)
        .map((seg) => seg.text),
    ).toEqual(['Markdown', 'Vue'])
  })

  test('raw carries the untouched hit', async () => {
    const results = await mapCaptured()
    expect(at(results, HIT.page).raw).toStrictEqual(capturedResponse().hits[HIT.page])
  })

  test('score is never set — Algolia ranking is not a comparable number', async () => {
    const results = await mapCaptured()
    for (const result of results) expect('score' in result).toBe(false)
  })
})

describe('hierarchy edge cases', () => {
  test('an lvl1 hit with only lvl0 and lvl1 keeps a single crumb', async () => {
    const [result] = await mapHits([
      {
        objectID: 'only-lvl0-lvl1',
        url: 'https://example.com/guide',
        type: 'lvl1',
        content: null,
        hierarchy: { lvl0: 'Guide', lvl1: 'Getting Started', lvl2: null },
      },
    ])
    expect(result?.titles?.map(textOf)).toEqual(['Guide'])
    expect(textOf(result?.title ?? [])).toBe('Getting Started')
    expect(result?.kind).toBe('page')
  })

  test('a hit with no _highlightResult falls back to plain hierarchy text', async () => {
    const [result] = await mapHits([
      {
        objectID: 'no-highlight',
        url: 'https://example.com/guide#deploy',
        type: 'lvl2',
        content: null,
        hierarchy: { lvl0: 'Guide', lvl1: `Deploying ${ZWSP}`, lvl2: `To Netlify ${ZWSP}` },
      },
    ])
    expect(textOf(result?.title ?? [])).toBe('To Netlify')
    expect(result?.title.some((seg) => seg.mark)).toBe(false)
    expect(result?.titles?.map(textOf)).toEqual(['Guide', 'Deploying'])
  })

  test('an own level present in _highlightResult but with no tags yields no marks', async () => {
    const [result] = await mapHits([
      {
        objectID: 'unmatched-level',
        url: 'https://example.com/guide#deploy',
        type: 'lvl2',
        content: null,
        hierarchy: { lvl0: 'Guide', lvl1: 'Deploying', lvl2: 'To Netlify' },
        _highlightResult: {
          hierarchy: {
            lvl0: { value: 'Guide' },
            lvl1: { value: `${PRE}Deploying${POST}` },
            lvl2: { value: 'To Netlify' },
          },
        },
      },
    ])
    expect(result?.title).toEqual([{ text: 'To Netlify' }])
    // ...while the ancestor keeps its mark
    expect(result?.titles?.[1]).toEqual([{ text: 'Deploying', mark: true }])
  })

  test('a whole-value match produces one marked segment, no empty siblings', async () => {
    const [result] = await mapHits([
      {
        objectID: 'full-match',
        url: 'https://example.com/api',
        type: 'lvl1',
        content: null,
        hierarchy: { lvl0: 'API', lvl1: `markdown ${ZWSP}` },
        _highlightResult: {
          hierarchy: { lvl1: { value: `${PRE}markdown${POST} ${ZWSP}` } },
        },
      },
    ])
    expect(result?.title).toEqual([{ text: 'markdown', mark: true }])
  })

  test('a content hit with an empty hierarchy degrades to an empty title', async () => {
    const [result] = await mapHits([
      {
        objectID: 'orphan-content',
        url: 'https://example.com/orphan',
        type: 'content',
        content: 'body text',
        hierarchy: {},
        _snippetResult: { content: { value: `body ${PRE}text${POST}` } },
      },
    ])
    // no level to title itself with; must not throw, and must not invent one
    expect(result?.title).toEqual([])
    expect(result?.titles).toEqual([])
    expect('group' in (result ?? {})).toBe(false)
    expect(result?.excerpt).toEqual([{ text: 'body ' }, { text: 'text', mark: true }])
  })

  test('an empty snippet value is treated as no excerpt', async () => {
    const [result] = await mapHits([
      {
        objectID: 'empty-snippet',
        url: 'https://example.com/empty',
        type: 'content',
        content: '',
        hierarchy: { lvl0: 'Guide', lvl1: 'Empty' },
        _snippetResult: { content: { value: '' } },
      },
    ])
    expect('excerpt' in (result ?? {})).toBe(false)
  })
})

/** Every user-visible string the adapter produced. */
function allText(results: SearchResult[]): string[] {
  return results.flatMap((result) => [
    textOf(result.title),
    ...(result.titles ?? []).map(textOf),
    ...(result.excerpt ? [textOf(result.excerpt)] : []),
    ...(result.group == null ? [] : [result.group]),
  ])
}
