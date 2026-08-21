/**
 * Minimal stand-ins for the VitePress objects the node-side modules read. `resolveSiteDataByRoute`
 * is the real one, so `site` must carry enough for it: a `locales` record above all.
 */

import type { DefaultTheme, SiteConfig } from 'vitepress'
import type { EmitAsset, PageInput } from '../../src/node/indexer.ts'

export interface TestLogger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  warnOnce: (message: string) => void
  clearScreen: () => void
  hasErrorLogged: () => boolean
  hasWarned: boolean
}

export const silentLogger = (): TestLogger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  warnOnce: () => {},
  clearScreen: () => {},
  hasErrorLogged: () => false,
  hasWarned: false,
})

/**
 * Only the per-locale keys the node modules read; `markdown` is what `mergeMarkdownLocales` folds
 * into the renderer options (#5350).
 */
export interface FakeLocale {
  label?: string
  lang?: string
  markdown?: Record<string, unknown>
}

export interface FakeSiteOptions {
  base?: string
  lang?: string
  cleanUrls?: boolean
  locales?: Record<string, FakeLocale>
  themeConfig?: DefaultTheme.Config
  srcDir?: string
  pages?: string[]
  markdown?: Record<string, unknown>
  /** `rewrites.map`: source path → route. */
  rewrites?: Record<string, string>
  /** Resolved dynamic routes; their `path` entries also appear in `pages`. */
  dynamicRoutes?: { route: string; path: string }[]
  logger?: TestLogger
}

export function fakeSiteConfig(options: FakeSiteOptions = {}): SiteConfig<DefaultTheme.Config> {
  const {
    base = '/',
    lang = 'en-US',
    cleanUrls = false,
    locales = { root: { label: 'English', lang } },
    themeConfig = {},
    srcDir = '/docs',
    pages = [],
    markdown = {},
    rewrites = {},
    dynamicRoutes = [],
    logger = silentLogger(),
  } = options

  return {
    site: { base, lang, title: 'Docs', description: 'docs', head: [], locales, themeConfig },
    cleanUrls,
    srcDir,
    publicDir: `${srcDir}/public`,
    pages,
    markdown,
    logger,
    rewrites: { map: rewrites, inv: {} },
    dynamicRoutes,
  } as unknown as SiteConfig<DefaultTheme.Config>
}

export function page(input: Partial<PageInput> & Pick<PageInput, 'relativePath'>): PageInput {
  return {
    relativePath: input.relativePath,
    filePath: input.filePath ?? input.relativePath,
    title: input.title ?? 'Untitled',
    frontmatter: input.frontmatter ?? {},
    html: input.html ?? '<main><p>placeholder body text</p></main>',
  }
}

/** A `<main>` document with one page-level section and one heading section. */
export const body = (prose: string, anchor = 'section', heading = 'Section'): string =>
  `<main><p>${prose}</p><h2 id="${anchor}">${heading}</h2><p>${prose} in ${heading}.</p></main>`

export interface Emitted {
  emit: EmitAsset
  files: Map<string, string>
}

export function captureEmits(): Emitted {
  const files = new Map<string, string>()
  return {
    files,
    emit: async (fileName, source) => {
      files.set(fileName, source)
    },
  }
}
