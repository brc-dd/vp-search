import { textOf } from '@vp-search/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadTier, runSearch, type LoadedTier, type TierState } from '../../src/engine.ts'
import { buildArtifact, hit, marked, marksOf, ZH_LANG, ZH_LONG, ZH_RECORDS } from './helpers.ts'

/** Round-trip findability, not token boundaries — DESIGN §13. */

/** Mirrors CONTEXT_CHARS in src/engine.ts. */
const CONTEXT_CHARS = 120
const ZH_GUIDE = '/zh/guide/index.html#快速开始'

let titles: LoadedTier
let both: TierState

beforeAll(() => {
  titles = loadTier(
    buildArtifact({
      lang: ZH_LANG,
      records: ZH_RECORDS,
      fields: ['title', 'titles'],
      storeFields: ['title', 'titles', 'group', 'kind'],
    }),
  )
  const content = loadTier(
    buildArtifact({
      lang: ZH_LANG,
      records: ZH_RECORDS,
      fields: ['title', 'titles', 'text'],
      storeFields: ['title', 'titles', 'text', 'group', 'kind'],
    }),
  )
  both = { titles, content }
})

describe('CJK round trip', () => {
  it('makes a heading query the top hit for its own record', () => {
    expect(hit(runSearch(both, '快速开始')).url).toBe(ZH_GUIDE)
  })

  it('makes an interior word of the body text findable', () => {
    // '生成器' sits mid-sentence with no spaces around it; it is only reachable because build and
    // query share one segmenter.
    expect(hit(runSearch(both, '生成器')).url).toBe(ZH_GUIDE)
  })

  it('finds the second record by a body word of its own', () => {
    expect(hit(runSearch(both, '包管理器')).url).toBe('/zh/reference/cli.html')
  })

  it('marks the zh title', () => {
    expect(marksOf(hit(runSearch(both, '快速开始')).title).length).toBeGreaterThan(0)
  })

  it('marks the zh excerpt', () => {
    expect(marksOf(marked(hit(runSearch(both, '生成器')).excerpt)).length).toBeGreaterThan(0)
  })

  it('answers a zh query from the titles tier alone, without an excerpt', () => {
    const titlesOnly = runSearch({ titles }, '快速开始')
    expect(hit(titlesOnly).url).toBe(ZH_GUIDE)
    expect(hit(titlesOnly).excerpt).toBeUndefined()
  })
})

describe('CJK excerpt bounds', () => {
  it('keeps the window inside the character budget with no spaces to stop at', () => {
    const text = textOf(marked(hit(runSearch(both, '生成器')).excerpt))
    // two context windows, the matched term, and up to two ellipses
    expect(text.length).toBeLessThanOrEqual(2 * CONTEXT_CHARS + '生成器'.length + 2)
  })

  it('elides rather than returning the whole section', () => {
    const text = textOf(marked(hit(runSearch(both, '生成器')).excerpt))
    expect(ZH_LONG.length).toBeGreaterThan(2 * CONTEXT_CHARS)
    expect(text.length).toBeLessThan(ZH_LONG.length)
    expect(text.endsWith('…')).toBe(true)
  })

  it('elides only the lead for a match near the end of the section', () => {
    const text = textOf(marked(hit(runSearch(both, '工作线程')).excerpt))
    expect(text.startsWith('…')).toBe(true)
  })
})
