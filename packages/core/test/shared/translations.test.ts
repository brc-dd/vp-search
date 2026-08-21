import { describe, expect, test } from 'vitest'
import {
  createSearchTranslate,
  defaultTranslations,
  interpolate,
  type SearchOptions,
  type SearchTranslationKey,
} from '../../src/translations.ts'

describe('interpolate', () => {
  test('substitutes placeholders, repeated keys included', () => {
    expect(interpolate('{count} results for {query}', { count: 12, query: 'vue' })).toBe(
      '12 results for vue',
    )
    expect(interpolate('{a} and {a}', { a: 'x' })).toBe('x and x')
  })

  test('stringifies numbers, zero included', () => {
    expect(interpolate('{n} results', { n: 0 })).toBe('0 results')
    expect(interpolate('{n}', { n: -1.5 })).toBe('-1.5')
  })

  test('leaves a placeholder with no value in place', () => {
    expect(interpolate('{a} {b}', { a: 'x' })).toBe('x {b}')
    expect(interpolate('{}', {})).toBe('{}')
    expect(interpolate('{a-b}', {})).toBe('{a-b}')
  })

  test('leaves a template without placeholders untouched', () => {
    expect(interpolate('No results', { query: 'x' })).toBe('No results')
    expect(interpolate('', {})).toBe('')
  })

  test('never rescans a substituted value', () => {
    expect(interpolate('{a}', { a: '{b}', b: 'nope' })).toBe('{b}')
    // a function replacement, so `$&` in user text is not a replacement pattern
    expect(interpolate('{a}', { a: '$& $1' })).toBe('$& $1')
  })
})

describe('createSearchTranslate', () => {
  const options: SearchOptions = {
    translations: { modal: { title: 'Root title', noResultsText: 'Root no results' } },
    locales: {
      zh: {
        translations: {
          button: { buttonText: '搜索' },
          modal: { noResultsText: '无法找到相关结果', footer: { selectText: '选择' } },
        },
      },
    },
  }

  test('falls back to the defaults when there are no options at all', () => {
    const t = createSearchTranslate(undefined, 'root')
    expect(t('modal.title')).toBe('Search')
    expect(t('modal.footer.closeKeyAriaLabel')).toBe('escape')
  })

  test('root translations override the defaults', () => {
    const t = createSearchTranslate(options, 'root')
    expect(t('modal.title')).toBe('Root title')
    expect(t('modal.noResultsText')).toBe('Root no results')
    expect(t('button.buttonText')).toBe('Search')
  })

  test('locale translations override root and defaults', () => {
    const t = createSearchTranslate(options, 'zh')
    expect(t('button.buttonText')).toBe('搜索')
    expect(t('modal.noResultsText')).toBe('无法找到相关结果')
  })

  test('each key walks the sources independently, so a partial section shadows nothing', () => {
    const t = createSearchTranslate(options, 'zh')
    // `modal` exists in all three sources; only the keys it actually sets win
    expect(t('modal.footer.selectText')).toBe('选择')
    expect(t('modal.footer.closeText')).toBe('to close')
    expect(t('modal.title')).toBe('Root title')
    expect(t('modal.idleText')).toBe('Type to search the documentation')
  })

  test('an unknown locale index resolves through root to the defaults', () => {
    const t = createSearchTranslate(options, 'de')
    expect(t('modal.title')).toBe('Root title')
    expect(t('modal.idleText')).toBe('Type to search the documentation')
  })

  test('an empty-object locale entry changes nothing', () => {
    const t = createSearchTranslate({ locales: { zh: {} } }, 'zh')
    expect(t('modal.title')).toBe('Search')
  })

  test('a key no source defines resolves to the empty string', () => {
    const t = createSearchTranslate(options, 'root')
    expect(t('modal.nope' as unknown as SearchTranslationKey)).toBe('')
  })
})

/**
 * Every leaf of `SearchTranslations`. `satisfies` rejects a key the interface does not declare;
 * `KeysAreExhaustive` below rejects a key it declares but this list omits.
 */
const KEYS = [
  'button.buttonText',
  'button.buttonAriaLabel',
  'modal.title',
  'modal.placeholderText',
  'modal.idleText',
  'modal.resetButtonTitle',
  'modal.backButtonTitle',
  'modal.resultsLabel',
  'modal.noResultsText',
  'modal.errorText',
  'modal.retryText',
  'modal.searchByText',
  'modal.announceResultsText',
  'modal.announceOneResultText',
  'modal.announceNoResultsText',
  'modal.footer.selectText',
  'modal.footer.selectKeyAriaLabel',
  'modal.footer.navigateText',
  'modal.footer.navigateUpKeyAriaLabel',
  'modal.footer.navigateDownKeyAriaLabel',
  'modal.footer.closeText',
  'modal.footer.closeKeyAriaLabel',
] as const satisfies readonly SearchTranslationKey[]

export type KeysAreExhaustive =
  Exclude<SearchTranslationKey, (typeof KEYS)[number]> extends never ? true : never
export const keysAreExhaustive: KeysAreExhaustive = true

function leafKeys(source: object, prefix = ''): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.push(path)
    else if (value !== null && typeof value === 'object') out.push(...leafKeys(value, path))
  }
  return out
}

describe('defaultTranslations', () => {
  test('declares exactly the keys the interface does', () => {
    expect(keysAreExhaustive).toBe(true)
    expect(leafKeys(defaultTranslations).toSorted()).toEqual([...KEYS].toSorted())
  })

  test('every key resolves to a non-empty string', () => {
    const t = createSearchTranslate(undefined, 'root')
    for (const key of KEYS) expect(t(key), key).not.toBe('')
  })

  test('the announcement templates carry the placeholders the modal interpolates', () => {
    const t = createSearchTranslate(undefined, 'root')
    expect(interpolate(t('modal.announceResultsText'), { count: 12, query: 'vue' })).toBe(
      '12 results for vue',
    )
    expect(interpolate(t('modal.announceOneResultText'), { count: 1, query: 'vue' })).toBe(
      '1 result for vue',
    )
    expect(interpolate(t('modal.announceNoResultsText'), { count: 0, query: 'vue' })).toBe(
      'No results for vue',
    )
  })
})
