import type { ProviderDefinition } from '@vp-search/core/node'
import path from 'node:path'
import type { DefaultTheme, SiteConfig } from 'vitepress'
import { createDevIndexer, type DevIndexer } from './node/dev.ts'
import { createIndexer, slash, type Indexer } from './node/indexer.ts'
import {
  DEV_SUBDIR,
  MANIFEST_NAME,
  type ManifestLocale,
  type MinisearchProviderOptions,
  type Tier,
} from './node/types.ts'

export type { MinisearchExtraField, MinisearchProviderOptions } from './node/types.ts'

const MANIFEST_MODULE = 'manifest'
const DEV_ARTIFACT_RE = new RegExp(`/${DEV_SUBDIR}/([^/?]+)\\.(titles|content)\\.json(?:\\?|$)`)

/**
 * MiniSearch-backed local search: per-locale index artifacts emitted at build
 * time and queried in a module worker. Indexing hangs off VitePress's own
 * build hooks rather than a pre-render vite chunk, so it sees final HTML:
 * dynamic routes, vite transforms and frontmatter interpolation are all in
 * the index.
 */
export function minisearch(options: MinisearchProviderOptions = {}): ProviderDefinition {
  let siteConfig: SiteConfig<DefaultTheme.Config> | undefined
  let indexer: Indexer | undefined
  let dev: DevIndexer | undefined
  let base = '/'
  let version = 0

  return {
    name: 'minisearch',
    clientModule: '@vp-search/minisearch/adapter',
    // The worker imports minisearch through this package, which is excluded
    // from prebundling; without this the dev cold-open waterfalls on it.
    clientDeps: ['minisearch'],

    node: {
      setup(config, api) {
        siteConfig = config as SiteConfig<DefaultTheme.Config>
        const idx = (indexer = createIndexer(siteConfig, options))
        if (api.dev) {
          base = `${siteConfig.site.base}${DEV_SUBDIR}/`
          dev = createDevIndexer(siteConfig, idx)
        } else {
          base = api.assetsBase
          api.onTransformHtml((page) => idx.index(page))
          api.onBuildEnd(async () => {
            await idx.write(api.emitAsset)
          })
        }

        api.addVirtualModule(MANIFEST_MODULE, async () => {
          if (!dev) {
            // Artifact names are only known after the bundle closes, so a build
            // defers the locale map to a manifest fetched at runtime.
            return `export default ${JSON.stringify({ base, locales: null, manifest: MANIFEST_NAME })}\n`
          }
          await dev.ready()
          const locales: Record<string, ManifestLocale> = {}
          for (const locale of idx.locales()) {
            locales[locale] = {
              lang: idx.lang(locale),
              titles: `${locale}.titles.json?v=${version}`,
              content: `${locale}.content.json?v=${version}`,
              sections: idx.sections(locale),
            }
          }
          return `export default ${JSON.stringify({ base, locales, manifest: null })}\n`
        })
      },

      configureServer(server) {
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

      async hotUpdate(file) {
        if (!dev || !siteConfig || !file.endsWith('.md')) return
        // Includes and route templates are not pages and have no records.
        const page = slash(path.relative(siteConfig.srcDir, file))
        if (!siteConfig.pages.includes(page)) return
        if (!(await dev.update(page))) return
        version++
        return [MANIFEST_MODULE]
      },
    },
  }
}
