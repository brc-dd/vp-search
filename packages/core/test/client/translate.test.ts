import { afterEach, describe, expect, test } from 'vitest'
import { useTranslate } from '../../src/client/translate.ts'
import { __reset as resetOptions, __setOptions } from '../../../../test/fixtures/options.ts'
import { __reset as resetVitepress, __setLocale } from '../../../../test/fixtures/vitepress.ts'

afterEach(() => {
  resetOptions()
  resetVitepress()
})

describe('useTranslate', () => {
  test('falls back to the defaults for keys no source overrides', () => {
    const t = useTranslate()
    expect(t('modal.title')).toBe('Search')
    expect(t('modal.footer.selectText')).toBe('to select')
  })

  test('resolves through the options module for the active locale', () => {
    __setLocale('zh', 'zh-CN')
    const t = useTranslate()
    expect(t('button.buttonText')).toBe('搜索')
    expect(t('modal.noResultsText')).toBe('无法找到相关结果')
    // untranslated keys of the same section still reach the defaults
    expect(t('modal.title')).toBe('Search')
  })

  test('re-resolves when the locale changes under a live translator', () => {
    const t = useTranslate()
    expect(t('button.buttonText')).toBe('Search')
    __setLocale('zh')
    expect(t('button.buttonText')).toBe('搜索')
    __setLocale('root')
    expect(t('button.buttonText')).toBe('Search')
  })

  test('an unknown locale index resolves through the root options', () => {
    __setOptions({ translations: { modal: { title: 'Root title' } } })
    __setLocale('de')
    const t = useTranslate()
    expect(t('modal.title')).toBe('Root title')
    expect(t('modal.idleText')).toBe('Type to search the documentation')
  })

  test('a locale entry outranks the root entry', () => {
    __setOptions({
      translations: { modal: { title: 'Root title' } },
      locales: { fr: { translations: { modal: { title: 'Recherche' } } } },
    })
    __setLocale('fr')
    const t = useTranslate()
    expect(t('modal.title')).toBe('Recherche')
    __setLocale('root')
    expect(t('modal.title')).toBe('Root title')
  })
})
