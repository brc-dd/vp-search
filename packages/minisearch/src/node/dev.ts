import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createMarkdownRenderer,
  mergeMarkdownLocales,
  resolveSiteDataByRoute,
  type DefaultTheme,
  type MarkdownEnv,
  type MarkdownRenderer,
  type SiteConfig,
} from 'vitepress'
import type { Indexer } from './indexer.ts'

/** Pages render independently; the renderer is a shared, reentrant singleton. */
const CONCURRENCY = 8

export interface DevIndexer {
  /** Indexes the whole site once, on the first artifact request. */
  ready(): Promise<void>
  /** False when nothing is indexed yet, so the caller can skip the HMR round. */
  update(page: string): Promise<boolean>
}

/**
 * `buildEnd` never fires in dev, so dev re-renders markdown itself instead of
 * reading final HTML. Documented fidelity gap: anything Vue evaluates at
 * render — vite transforms, dynamic routes, `$frontmatter` interpolation,
 * `<script setup>` values, data loaders — only reaches production indexes,
 * while `<ClientOnly>` slots invert (indexed here, absent from SSR output and
 * so from production).
 */
export function createDevIndexer(
  siteConfig: SiteConfig<DefaultTheme.Config>,
  indexer: Indexer,
): DevIndexer {
  let renderer: Promise<MarkdownRenderer> | undefined
  let scan: Promise<void> | undefined

  function md(): Promise<MarkdownRenderer> {
    return (renderer ??= createMarkdownRenderer(
      siteConfig.srcDir,
      // The renderer is a singleton shared with markdownToVue, so it must be
      // asked for with the complete, locale-merged options (#5350).
      mergeMarkdownLocales(siteConfig.markdown, siteConfig.site.locales),
      siteConfig.site.base,
      siteConfig.logger,
      siteConfig.publicDir,
    ))
  }

  async function indexPage(page: string): Promise<void> {
    const relativePath = siteConfig.rewrites.map[page] ?? page
    const file = path.join(siteConfig.srcDir, page)
    const { localeIndex } = resolveSiteDataByRoute(siteConfig.site, relativePath, page)
    const env: MarkdownEnv = {
      path: file,
      relativePath,
      cleanUrls: siteConfig.cleanUrls ?? false,
      ...(localeIndex != null && { localeIndex }),
    }

    let html: string
    try {
      html = await (await md()).renderAsync(await readFile(file, 'utf-8'), env)
    } catch (error) {
      // A page that fails to render must not take the dev server down; its own
      // markdown transform already surfaces the error.
      siteConfig.logger.warn(
        `[vp-search] minisearch failed to index ${page}: ${(error as Error).message}`,
      )
      return
    }

    indexer.index(
      {
        relativePath,
        filePath: page,
        title: pageTitle(env),
        frontmatter: env.frontmatter ?? {},
        // The build sees a full page; dev has only the rendered body, so it
        // gets the `<main>` wrapper `contentSelector` looks for.
        html: `<main>${html}</main>`,
      },
      true,
    )
  }

  async function scanAll(): Promise<void> {
    // Resolved dynamic routes sit in `pages` with no source file behind them —
    // the production-only slice of the fidelity gap; reading them would only
    // warn ENOENT once per route per scan.
    const dynamic = new Set(siteConfig.dynamicRoutes?.map((route) => route.path))
    const pages = siteConfig.pages.filter((page) => !dynamic.has(page))
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pages.length) }, async () => {
        while (cursor < pages.length) await indexPage(pages[cursor++]!)
      }),
    )
  }

  return {
    ready: () => (scan ??= scanAll()),
    async update(page: string) {
      // Until search is first opened there is no index to keep up to date.
      if (!scan) return false
      await scan
      await indexPage(page)
      return true
    },
  }
}

function pageTitle(env: MarkdownEnv): string {
  const title = env.frontmatter?.['title']
  return typeof title === 'string' ? title : (env['title'] ?? '')
}
