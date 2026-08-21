import { ref, type Ref } from 'vue'

/**
 * Stand-in for the `vitepress` client entry, aliased in by the `client` project. Only what
 * `packages/core/src/client/` imports is implemented.
 *
 * Components reach it through the alias; tests import this file directly for the `__`-prefixed
 * helpers. Both land on the same module instance, so state is shared.
 */

export interface FixtureSiteData {
  base: string
  cleanUrls?: boolean
  lang: string
  dir: string
  title: string
  description: string
  themeConfig: Record<string, unknown>
}

export interface FixtureRouter {
  route: { path: string; hash: string; query: string }
  go: (to: string) => Promise<void>
}

function defaultSite(): FixtureSiteData {
  return {
    base: '/',
    cleanUrls: false,
    lang: 'en-US',
    dir: 'ltr',
    title: 'Fixture',
    description: 'Fixture site',
    themeConfig: {},
  }
}

const site = ref<FixtureSiteData>(defaultSite())
const theme = ref<Record<string, unknown>>({})
const page = ref<Record<string, unknown>>({ relativePath: 'index.md', frontmatter: {} })
const frontmatter = ref<Record<string, unknown>>({})
const params = ref<Record<string, unknown> | null>(null)
const title = ref('Fixture')
const description = ref('Fixture site')
const lang = ref('en-US')
const dir = ref('ltr')
const localeIndex = ref('root')
const isDark = ref(false)

export interface FixtureData {
  site: Ref<FixtureSiteData>
  theme: Ref<Record<string, unknown>>
  page: Ref<Record<string, unknown>>
  frontmatter: Ref<Record<string, unknown>>
  params: Ref<Record<string, unknown> | null>
  title: Ref<string>
  description: Ref<string>
  lang: Ref<string>
  dir: Ref<string>
  localeIndex: Ref<string>
  isDark: Ref<boolean>
}

export function useData(): FixtureData {
  return {
    site,
    theme,
    page,
    frontmatter,
    params,
    title,
    description,
    lang,
    dir,
    localeIndex,
    isDark,
  }
}

/** Navigations land here; `vi.spyOn(__router, 'go')` also works. */
export const __navigations: string[] = []

export const __router: FixtureRouter = {
  route: { path: '/', hash: '', query: '' },
  go(to: string) {
    __navigations.push(to)
    return Promise.resolve()
  },
}

export function useRouter(): FixtureRouter {
  return __router
}

export function __setLocale(index: string, langTag?: string): void {
  localeIndex.value = index
  if (langTag !== undefined) lang.value = langTag
}

export function __setSite(patch: Partial<FixtureSiteData>): void {
  site.value = { ...site.value, ...patch }
}

export function __reset(): void {
  site.value = defaultSite()
  theme.value = {}
  page.value = { relativePath: 'index.md', frontmatter: {} }
  frontmatter.value = {}
  params.value = null
  title.value = 'Fixture'
  description.value = 'Fixture site'
  lang.value = 'en-US'
  dir.value = 'ltr'
  localeIndex.value = 'root'
  isDark.value = false
  __router.route = { path: '/', hash: '', query: '' }
  __navigations.length = 0
}
