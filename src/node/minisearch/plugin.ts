import path from 'node:path'
import type { Plugin } from 'vite'
import type { DefaultTheme, SiteConfig } from 'vitepress'
import { createDevIndexer, type DevIndexer } from './dev.ts'
import { createIndexer, slash, type Indexer } from './indexer.ts'
import {
  DEV_SUBDIR,
  MANIFEST_NAME,
  OUT_SUBDIR,
  type ManifestLocale,
  type MinisearchAdapterOptions,
  type Tier,
} from './types.ts'

const VIRTUAL_ID = 'virtual:any-search/minisearch'
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID
const DEV_ARTIFACT_RE = new RegExp(`/${DEV_SUBDIR}/([^/?]+)\\.(titles|content)\\.json(?:\\?|$)`)

/** VitePress resolves its config once per build; the hooks must wrap once too. */
const wrapped = new WeakSet<SiteConfig>()

/**
 * Emits the per-locale MiniSearch artifacts and the virtual module the adapter
 * reads them through. Indexing hangs off VitePress's own build hooks rather
 * than a pre-render vite chunk, so it sees final HTML: dynamic routes, vite
 * transforms and frontmatter interpolation are all in the index.
 */
export function minisearchPlugin(options: MinisearchAdapterOptions | null, pkg: string): Plugin {
  let siteConfig: SiteConfig<DefaultTheme.Config> | undefined
  let indexer: Indexer | undefined
  let dev: DevIndexer | undefined
  let base = '/'
  let version = 0

  return {
    name: `${pkg}:minisearch`,

    config() {
      if (!options) return
      // The worker imports minisearch through this package, which is excluded
      // from prebundling; without this the dev cold-open waterfalls on it.
      return { optimizeDeps: { include: [`${pkg} > minisearch`] } }
    },

    configResolved(config) {
      if (!options || !config.vitepress || siteConfig) return
      siteConfig = config.vitepress
      indexer = createIndexer(siteConfig, options)
      if (config.command === 'serve') {
        base = `${siteConfig.site.base}${DEV_SUBDIR}/`
        dev = createDevIndexer(siteConfig, indexer, config.publicDir)
      } else {
        base = `${siteConfig.site.base}${OUT_SUBDIR}/`
        wrapBuildHooks(siteConfig, indexer)
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
    },

    async load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return
      // A stub keeps the adapter's import resolvable under other providers.
      if (!options || !indexer) return 'export default null\n'
      if (!dev) {
        // Artifact names are only known after the bundle closes, so a build
        // defers the locale map to a manifest fetched at runtime.
        return `export default ${JSON.stringify({ base, locales: null, manifest: MANIFEST_NAME })}\n`
      }
      await dev.ready()
      const locales: Record<string, ManifestLocale> = {}
      for (const locale of indexer.locales()) {
        locales[locale] = {
          lang: indexer.lang(locale),
          titles: `${locale}.titles.json?v=${version}`,
          content: `${locale}.content.json?v=${version}`,
          sections: indexer.sections(locale),
        }
      }
      return `export default ${JSON.stringify({ base, locales, manifest: null })}\n`
    },

    configureServer(server) {
      if (!options) return
      server.middlewares.use((req, res, next) => {
        const match = DEV_ARTIFACT_RE.exec(req.url ?? '')
        if (!match || !dev || !indexer || !indexer.locales().includes(match[1]!)) return next()
        dev.ready().then(() => {
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-cache')
          res.end(indexer!.artifact(match[1]!, match[2] as Tier))
        }, next)
      })
    },

    async hotUpdate(ctx) {
      if (!dev || !siteConfig || this.environment.name !== 'client') return
      if (!ctx.file.endsWith('.md')) return
      // Includes and route templates are not pages and have no records.
      const page = slash(path.relative(siteConfig.srcDir, ctx.file))
      if (!siteConfig.pages.includes(page)) return
      if (!(await dev.update(page))) return

      version++
      const mod = this.environment.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)
      if (!mod) return
      this.environment.moduleGraph.invalidateModule(mod)
      return [...ctx.modules, mod]
    },
  }
}

function wrapBuildHooks(siteConfig: SiteConfig<DefaultTheme.Config>, indexer: Indexer): void {
  if (wrapped.has(siteConfig)) return
  wrapped.add(siteConfig)

  const userTransformHtml = siteConfig.transformHtml
  siteConfig.transformHtml = async (code, id, ctx) => {
    const result = await userTransformHtml?.(code, id, ctx)
    try {
      indexer.index({
        relativePath: ctx.pageData.relativePath,
        filePath: ctx.pageData.filePath,
        title: ctx.pageData.title,
        frontmatter: ctx.pageData.frontmatter,
        html: typeof result === 'string' ? result : code,
      })
    } catch (error) {
      siteConfig.logger.warn(
        `[vitepress-any-search] failed to index ${ctx.page} for search: ${(error as Error).message}`,
      )
    }
    return result
  }

  const userBuildEnd = siteConfig.buildEnd
  siteConfig.buildEnd = async (config) => {
    await userBuildEnd?.(config)
    await indexer.write(config.outDir)
  }
}
