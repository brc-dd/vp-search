/**
 * Back-compat over a frozen `v: 1` pair (see `../fixtures/artifact-v1.ts` for
 * its provenance and corpus). Everything here is what a reader's browser does
 * with an artifact this repo emitted months ago: parse it, `loadTier` it, and
 * search it with today's engine.
 */

import { textOf } from '@vp-search/core'
import { describe, expect, it } from 'vitest'
import { loadTier, runSearch, type LoadedTier, type TierState } from '../../src/engine.ts'
import {
  CONTENT_FIELDS,
  CONTENT_STORE_FIELDS,
  TITLES_FIELDS,
  TITLES_STORE_FIELDS,
} from '../../src/fields.ts'
import { FIXTURE_IDS, FIXTURE_LANG, frozenArtifact } from '../fixtures/artifact-v1.ts'

/** Both tiers, always present — `TierState` leaves them optional. */
const tiers = (): { titles: LoadedTier; content: LoadedTier } => ({
  titles: loadTier(frozenArtifact('titles')),
  content: loadTier(frozenArtifact('content')),
})

const urls = (state: TierState, query: string): string[] =>
  runSearch(state, query)
    .results.map((result) => result.url)
    .sort()

describe('envelope', () => {
  it('is still version 1', () => {
    expect(frozenArtifact('titles').v).toBe(1)
    expect(frozenArtifact('content').v).toBe(1)
    // `loadTier` does not read `v` today, and what a future `v !== 1` should
    // do — refuse, warn, or migrate — is parked, not decided (TODO §6,
    // minisearch provider). This fixture is the trigger for that decision,
    // not a specification of it: do not grow version-negotiation behaviour
    // here without deciding it there first.
  })

  it('carries the lang the tokenizer is rebuilt from', () => {
    expect(frozenArtifact('titles').lang).toBe(FIXTURE_LANG)
    expect(frozenArtifact('content').lang).toBe(FIXTURE_LANG)
  })

  it('carries the tier field split today’s indexer still emits', () => {
    expect(frozenArtifact('titles').options).toEqual({
      fields: [...TITLES_FIELDS],
      storeFields: [...TITLES_STORE_FIELDS],
    })
    expect(frozenArtifact('content').options).toEqual({
      fields: [...CONTENT_FIELDS],
      storeFields: [...CONTENT_STORE_FIELDS],
    })
  })

  it('carries no searchOptions, since the corpus configured none', () => {
    expect(frozenArtifact('content').options).not.toHaveProperty('searchOptions')
  })
})

describe('loadTier', () => {
  it('rehydrates both tiers of the frozen pair', () => {
    const state = tiers()
    expect(state.titles.engine.documentCount).toBe(FIXTURE_IDS.length)
    expect(state.content.engine.documentCount).toBe(FIXTURE_IDS.length)
  })

  it('applies today’s parity defaults on top of the frozen options', () => {
    expect(tiers().content.searchOptions).toEqual({
      fuzzy: 0.2,
      prefix: true,
      boost: { title: 4, text: 2, titles: 1 },
    })
  })
})

describe('search', () => {
  it('answers a title query at the frozen id', () => {
    expect(urls(tiers(), 'internationalization')).toContain('/guide/i18n.html')
  })

  it('answers a body query only the content tier can serve', () => {
    const { titles, content } = tiers()
    expect(urls({ titles }, 'toolchain')).toEqual([])
    expect(urls({ titles, content }, 'package manager')).toContain('/reference/cli.html')
  })

  it('answers a sidebar-label query from either tier', () => {
    const { titles, content } = tiers()
    expect(urls({ titles }, 'Reference')).toEqual(urls({ titles, content }, 'Reference'))
    expect(urls({ titles }, 'Reference')).toContain('/reference/cli.html')
  })

  it('answers a CJK query against terms segmented by an older ICU', () => {
    // The frozen index holds whatever `Intl.Segmenter` produced in 2026-08;
    // the query is segmented by whatever ICU runs today. A single Han
    // character is the invariant across that gap — it is one word-like
    // segment under any ICU, and `prefix: true` reaches the frozen multi-char
    // term it starts. Asserting an exact frozen boundary would be asserting
    // an ICU version (DESIGN §13, determinism).
    expect(urls(tiers(), '中')).toContain('/guide/i18n.html#cjk')
    expect(urls(tiers(), '搜索')).toContain('/guide/i18n.html#cjk')
  })

  it('still maps the frozen stored fields onto the shared result shape', () => {
    const result = runSearch(tiers(), 'internationalization').results[0]
    expect(result?.url).toBe('/guide/i18n.html')
    expect(textOf(result?.title ?? [])).toBe('Internationalization')
    expect(result?.group).toBe('Guide')
    expect(result?.kind).toBe('page')
    expect(textOf(result?.excerpt ?? [])).toContain('artifact pair')
  })
})
