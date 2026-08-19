import options from 'virtual:any-search/options'
import { useData } from 'vitepress'
import { computed } from 'vue'
import { createSearchTranslate, type SearchTranslationKey } from '../translations.ts'

/** Locale-reactive translator shared by the button and the modal. */
export function useTranslate() {
  const { localeIndex } = useData()
  const translate = computed(() => createSearchTranslate(options, localeIndex.value))
  return (key: SearchTranslationKey) => translate.value(key)
}
