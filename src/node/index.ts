import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { AlgoliaAdapterOptions } from '../adapters/algolia.ts'
import type { SearchTranslations } from '../translations.ts'
import { minisearchPlugin } from './minisearch/plugin.ts'
import type { MinisearchAdapterOptions } from './minisearch/types.ts'

export type { MinisearchAdapterOptions } from './minisearch/types.ts'

const PKG = 'vitepress-any-search'

/** `\0` marks an id as synthetic: Vite skips disk lookups, other plugins skip the id. */
const ADAPTER_ID = 'virtual:any-search/adapter'
const RESOLVED_ADAPTER_ID = '\0' + ADAPTER_ID
const OPTIONS_ID = 'virtual:any-search/options'
const RESOLVED_OPTIONS_ID = '\0' + OPTIONS_ID

/**
 * VitePress 2 reaches its search component through two specifiers: VPNavBar.vue
 * imports `./VPNavBarSearch.vue`, while theme-default/without-fonts.ts re-exports
 * `./components/VPNavBarSearch.vue`. Aliasing only the first — what every
 * incumbent plugin does — leaves the `vitepress/theme` named export un-hijacked.
 */
const SEARCH_SPECIFIERS = ['./VPNavBarSearch.vue', './components/VPNavBarSearch.vue']

interface AnySearchSharedOptions {
  translations?: SearchTranslations
  /** Keyed by VitePress localeIndex ('root', 'zh', …). */
  locales?: Record<string, { translations?: SearchTranslations }>
}

export type AnySearchPluginOptions =
  | (AnySearchSharedOptions & { provider: 'algolia'; options: AlgoliaAdapterOptions })
  | (AnySearchSharedOptions & { provider: 'minisearch'; options?: MinisearchAdapterOptions })
  /** Module path whose default export is a constructed `SearchAdapter`. */
  | (AnySearchSharedOptions & { adapterFile: string })

export function anySearch(options: AnySearchPluginOptions): Plugin[] {
  const minisearch =
    'provider' in options && options.provider === 'minisearch' ? (options.options ?? {}) : null
  return [corePlugin(options), minisearchPlugin(minisearch, PKG)]
}

function corePlugin(options: AnySearchPluginOptions): Plugin {
  const component = resolveSearchComponent()
  let root = process.cwd()

  return {
    name: PKG,
    // No `enforce`: VitePress lists its own plugin before `vite.plugins`, so a
    // plain plugin's config hook runs after it. That is what puts our alias
    // ahead of VitePress's and lets us see user aliases for collision checks.

    config(userConfig) {
      for (const specifier of SEARCH_SPECIFIERS) {
        const claimed = findAlias(userConfig.resolve?.alias, specifier)
        if (claimed !== undefined && claimed !== component) {
          console.warn(
            `[${PKG}] resolve.alias already maps ${JSON.stringify(specifier)} to ` +
              `${JSON.stringify(claimed)} — another plugin is hijacking VitePress's search ` +
              `component. Alias merge is last-wins, so ${PKG} takes over; remove one of the ` +
              `two plugins to make the choice explicit.`,
          )
        }
      }
      return {
        resolve: {
          alias: Object.fromEntries(SEARCH_SPECIFIERS.map((s) => [s, component])),
          // A workspace-linked copy of this package would otherwise get its own Vue.
          dedupe: ['vue'],
        },
        // We ship raw .vue/.ts: never esbuild-prebundle it, always SSR-compile it.
        optimizeDeps: { exclude: [PKG] },
        ssr: { noExternal: [PKG] },
      }
    },

    configResolved(resolvedConfig) {
      root = resolvedConfig.root
    },

    resolveId(id) {
      if (id === ADAPTER_ID) return RESOLVED_ADAPTER_ID
      if (id === OPTIONS_ID) return RESOLVED_OPTIONS_ID
    },

    load(id) {
      if (id === RESOLVED_ADAPTER_ID) {
        if ('adapterFile' in options) {
          const file = isAbsolute(options.adapterFile)
            ? options.adapterFile
            : resolve(root, options.adapterFile)
          return `export { default } from ${JSON.stringify(slash(file))}\n`
        }
        if (options.provider === 'minisearch') {
          return (
            `import { minisearchAdapter } from '${PKG}/adapters/minisearch'\n` +
            `export default minisearchAdapter()\n`
          )
        }
        return (
          `import { algoliaAdapter } from '${PKG}/adapters/algolia'\n` +
          `export default algoliaAdapter(${JSON.stringify(options.options)})\n`
        )
      }
      if (id === RESOLVED_OPTIONS_ID) {
        const { translations, locales } = options
        return `export default ${JSON.stringify({ translations, locales })}\n`
      }
    },
  }
}

function resolveSearchComponent(): string {
  const candidates: string[] = []
  try {
    candidates.push(fileURLToPath(import.meta.resolve(`${PKG}/client/VPNavBarSearch.vue`)))
  } catch {}
  candidates.push(fileURLToPath(new URL('../client/VPNavBarSearch.vue', import.meta.url)))
  // Self-reference can land outside this checkout when the package is linked.
  return candidates.find(existsSync) ?? candidates.at(-1)!
}

interface AliasEntry {
  find: string | RegExp
  replacement: string
}

function findAlias(alias: unknown, specifier: string): string | undefined {
  if (Array.isArray(alias)) {
    const entries = alias as AliasEntry[]
    return entries.find((e) =>
      typeof e.find === 'string' ? e.find === specifier : e.find.test(specifier),
    )?.replacement
  }
  if (alias && typeof alias === 'object') {
    return (alias as Record<string, string | undefined>)[specifier]
  }
  return undefined
}

/** Vite ids are forward-slashed on every platform. */
function slash(p: string): string {
  return p.replace(/\\/g, '/')
}
