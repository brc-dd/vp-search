import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'
import type { SiteConfig } from 'vitepress'
import type { SearchOptions } from '../translations.ts'

export type { SearchOptions } from '../translations.ts'

const PKG = '@vp-search/core'
const TAG = '[vp-search]'

/** `\0` marks an id as synthetic: Vite skips disk lookups, other plugins skip the id. */
const VIRTUAL_PREFIX = 'virtual:vp-search/'
const ADAPTER_ID = 'virtual:vp-search/adapter'
const OPTIONS_ID = 'virtual:vp-search/options'
const PROVIDER_OPTIONS_ID = 'virtual:vp-search/provider-options'

/** Provider build artifacts (`emitAsset`) land under `outDir/vp-search/`. */
const ASSETS_SUBDIR = 'vp-search'

/** Both specifiers VitePress resolves its search component through (DESIGN §7). */
const SEARCH_SPECIFIERS = ['./VPNavBarSearch.vue', './components/VPNavBarSearch.vue']

/** A rendered page, as VitePress's build hooks see it. */
export interface ProviderPage {
  /** Relative to `srcDir`, rewrites applied — the route, not the source file. */
  relativePath: string
  /** Relative to `srcDir`, as authored; resolves colocated additional configs. */
  filePath: string
  title: string
  frontmatter: Record<string, unknown>
  /** Final rendered HTML of the whole page. */
  html: string
}

/** Core-owned services a provider's node hooks build on. */
export interface ProviderApi {
  /** True under `vitepress dev`, where the two build hooks below never fire. */
  readonly dev: boolean
  /** Public URL prefix of `emitAsset` files, site base included. */
  readonly assetsBase: string
  /**
   * Called once per rendered page during a build. Callback errors degrade to per-page warnings
   * rather than failing the build.
   */
  onTransformHtml(cb: (page: ProviderPage) => void): void
  /** Called after the user's own `buildEnd`, before the build finishes. */
  onBuildEnd(cb: () => Promise<void> | void): void
  /**
   * Registers `virtual:vp-search/<provider>/<id>`; any unregistered id in that namespace loads as a
   * `null` stub instead of 404ing, so an inactive provider's client code can detect it.
   */
  addVirtualModule(id: string, load: () => string | Promise<string>): void
  /** Writes `outDir/vp-search/<fileName>`; call it during `onBuildEnd`. */
  emitAsset(fileName: string, source: string | Uint8Array): Promise<void>
}

/**
 * What a provider package's factory returns (DESIGN §8b). Plumbed through by core: client half via
 * `virtual:vp-search/adapter`, node half via {@link ProviderApi}.
 */
export interface ProviderDefinition {
  /** Provider identifier; namespaces its virtual modules and log lines. */
  name: string
  /**
   * Module whose default export is a factory `(clientOptions) => SearchAdapter`. Instantiated via
   * `virtual:vp-search/adapter` (a module reference, so nothing needs to serialize across node →
   * client). Accepts a bare specifier, a `virtual:` id, or a file path — relative paths resolve
   * against the VitePress project root, not vite's `srcDir`.
   */
  clientModule: string
  /** JSON-serializable argument for the client factory. */
  clientOptions?: unknown
  /**
   * Bare package names `clientModule` imports at runtime. The provider package ships raw TS and is
   * excluded from prebundling, so its deps need listing here (`<provider package> > <dep>`) or the
   * dev cold-open waterfalls on them.
   */
  clientDeps?: string[]
  /** Node-side participation; remote-backend providers need none of it. */
  node?: {
    setup?(siteConfig: SiteConfig, api: ProviderApi): void
    configureServer?(server: ViteDevServer, api: ProviderApi): void
    /**
     * Dev-only file-change hook. Returned ids (as passed to `addVirtualModule`) are invalidated and
     * pushed to connected clients.
     */
    hotUpdate?(file: string, api: ProviderApi): Promise<string[] | void> | string[] | void
  }
}

/** VitePress resolves its config once per build; the hooks must wrap once too. */
const wrapped = new WeakSet<SiteConfig>()

export function search(provider: ProviderDefinition, options: SearchOptions = {}): Plugin {
  const spec = provider.clientModule
  // Misconfiguration should fail while the config is loading, not mid-build.
  const kind = classify(spec)
  const component = resolveSearchComponent()
  let base = process.cwd()
  let api: ProviderApi | undefined

  const virtuals = new Map<string, () => string | Promise<string>>()
  const pageCallbacks: Array<(page: ProviderPage) => void> = []
  const buildEndCallbacks: Array<() => Promise<void> | void> = []

  return {
    name: 'vp-search',
    // No `enforce`: VitePress lists its own plugin before `vite.plugins`, so a plain plugin's
    // config hook runs after it. That is what puts our alias ahead of VitePress's and lets us see
    // user aliases for collision checks.

    config(userConfig) {
      for (const specifier of SEARCH_SPECIFIERS) {
        const claimed = findAlias(userConfig.resolve?.alias, specifier)
        if (claimed !== undefined && claimed !== component) {
          console.warn(
            `${TAG} resolve.alias already maps ${JSON.stringify(specifier)} to ` +
              `${JSON.stringify(claimed)} — another plugin is hijacking VitePress's search ` +
              `component. Alias merge is last-wins, so vp-search takes over; remove one of ` +
              `the two plugins to make the choice explicit.`,
          )
        }
      }
      // Core and the provider package ship raw .vue/.ts: never esbuild-prebundle them, always
      // SSR-compile them.
      const rawPackages = [PKG]
      const providerPackage = kind === 'bare' ? packageOf(spec) : undefined
      if (providerPackage && providerPackage !== PKG) rawPackages.push(providerPackage)
      // Virtual/path client modules are never prebundled or externalized, so their deps go in as
      // plain entries rather than `pkg > dep` chains.
      const include = (provider.clientDeps ?? []).map((dep) =>
        providerPackage ? `${providerPackage} > ${dep}` : dep,
      )
      return {
        resolve: {
          alias: Object.fromEntries(SEARCH_SPECIFIERS.map((s) => [s, component])),
          // A workspace-linked copy of this package would otherwise get its own Vue.
          dedupe: ['vue'],
        },
        optimizeDeps: { exclude: rawPackages, ...(include.length && { include }) },
        ssr: { noExternal: rawPackages },
      }
    },

    configResolved(resolvedConfig) {
      const siteConfig = resolvedConfig.vitepress
      // User paths resolve like VitePress's own do: against the project root (dir containing
      // `.vitepress`), not vite's `srcDir`, which is the content tree when srcDir is customized.
      base = siteConfig?.root ?? resolvedConfig.root
      if (!provider.node || !siteConfig || api) return
      api = createProviderApi(siteConfig, resolvedConfig.command === 'serve', {
        name: provider.name,
        virtuals,
        pageCallbacks,
        buildEndCallbacks,
      })
      provider.node.setup?.(siteConfig, api)
      if (!api.dev && (pageCallbacks.length || buildEndCallbacks.length)) {
        wrapBuildHooks(siteConfig, provider.name, pageCallbacks, buildEndCallbacks)
      }
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) return '\0' + id
    },

    async load(id) {
      if (!id.startsWith('\0' + VIRTUAL_PREFIX)) return
      const bare = id.slice(1)
      if (bare === ADAPTER_ID) {
        // Resolvability is checked here — the one hook with resolver access across dev/build/SSR —
        // so failures name the option and base dir (DESIGN §8b). Virtual ids are emitted raw, never
        // pre-resolved: `\0` can't appear in a specifier, so the providing plugin's resolveId must
        // run at import time.
        const emitted =
          kind === 'path' ? slash(isAbsolute(spec) ? spec : resolve(base, spec)) : spec
        const resolved = await this.resolve(emitted, slash(join(base, 'index.html'))).catch(
          () => null,
        )
        if (!resolved) {
          this.error(
            `cannot resolve clientModule ${JSON.stringify(spec)} from ${base}. ${advice(kind)}`,
          )
        }
        return (
          `import create from ${JSON.stringify(emitted)}\n` +
          `import options from ${JSON.stringify(PROVIDER_OPTIONS_ID)}\n` +
          `export default create(options)\n`
        )
      }
      if (bare === OPTIONS_ID) {
        const { translations, locales } = options
        return `export default ${JSON.stringify({ translations, locales })}\n`
      }
      if (bare === PROVIDER_OPTIONS_ID) {
        const value = provider.clientOptions
        return `export default ${value === undefined ? 'undefined' : JSON.stringify(value)}\n`
      }
      const virtual = virtuals.get(bare)
      if (virtual) return virtual()
      // A stub keeps an inactive provider's imports resolvable.
      return 'export default null\n'
    },

    configureServer(server) {
      if (api) provider.node?.configureServer?.(server, api)
    },

    async hotUpdate(ctx) {
      if (!api || !provider.node?.hotUpdate) return
      if (this.environment.name !== 'client') return
      const ids = await provider.node.hotUpdate(ctx.file, api)
      if (!ids?.length) return
      const graph = this.environment.moduleGraph
      const invalidated = ids.flatMap((id) => {
        const mod = graph.getModuleById(`\0${VIRTUAL_PREFIX}${provider.name}/${id}`)
        if (!mod) return []
        graph.invalidateModule(mod)
        return [mod]
      })
      if (invalidated.length) return [...ctx.modules, ...invalidated]
    },
  }
}

interface ProviderRegistry {
  name: string
  virtuals: Map<string, () => string | Promise<string>>
  pageCallbacks: Array<(page: ProviderPage) => void>
  buildEndCallbacks: Array<() => Promise<void> | void>
}

function createProviderApi(
  siteConfig: SiteConfig,
  dev: boolean,
  registry: ProviderRegistry,
): ProviderApi {
  return {
    dev,
    assetsBase: `${siteConfig.site.base}${ASSETS_SUBDIR}/`,
    onTransformHtml(cb) {
      registry.pageCallbacks.push(cb)
    },
    onBuildEnd(cb) {
      registry.buildEndCallbacks.push(cb)
    },
    addVirtualModule(id, load) {
      registry.virtuals.set(`${VIRTUAL_PREFIX}${registry.name}/${id}`, load)
    },
    async emitAsset(fileName, source) {
      const file = join(siteConfig.outDir, ASSETS_SUBDIR, fileName)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, source)
    },
  }
}

function wrapBuildHooks(
  siteConfig: SiteConfig,
  name: string,
  pageCallbacks: ReadonlyArray<(page: ProviderPage) => void>,
  buildEndCallbacks: ReadonlyArray<() => Promise<void> | void>,
): void {
  if (wrapped.has(siteConfig)) {
    // The latch is per-SiteConfig but callbacks are per-instance, so a second search() plugin's
    // build hooks would silently never run without this warning; configResolved runs once per
    // instance, so it fires exactly once.
    siteConfig.logger.warn(
      `${TAG} a second search() plugin is configured for this site, so the ${name} provider's ` +
        `build hooks are ignored — it will index nothing. Keep one search() call; its provider ` +
        `is the site's search backend.`,
    )
    return
  }
  wrapped.add(siteConfig)

  const userTransformHtml = siteConfig.transformHtml
  siteConfig.transformHtml = async (code, id, ctx) => {
    const result = await userTransformHtml?.(code, id, ctx)
    const page: ProviderPage = {
      relativePath: ctx.pageData.relativePath,
      filePath: ctx.pageData.filePath,
      title: ctx.pageData.title,
      frontmatter: ctx.pageData.frontmatter,
      html: typeof result === 'string' ? result : code,
    }
    for (const cb of pageCallbacks) {
      try {
        cb(page)
      } catch (error) {
        siteConfig.logger.warn(
          `${TAG} ${name} failed to index ${ctx.page}: ${(error as Error).message}`,
        )
      }
    }
    return result
  }

  const userBuildEnd = siteConfig.buildEnd
  siteConfig.buildEnd = async (config) => {
    await userBuildEnd?.(config)
    for (const cb of buildEndCallbacks) await cb()
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

/** How a specifier option is treated; misuse throws while config loads. */
type SpecifierKind = 'bare' | 'path' | 'virtual'

/** Mirrors vite's own bare-import test: scheme-less and not a path. */
const BARE_RE = /^[\w@](?!.*:\/\/)/

function classify(specifier: string): SpecifierKind {
  const reject = (why: string): never => {
    throw new Error(`${TAG} clientModule ${JSON.stringify(specifier)}: ${why}`)
  }
  if (specifier.startsWith('\0')) {
    return reject('`\\0`-prefixed ids are bundler-internal — pass the plain id')
  }
  if (specifier.startsWith('virtual:')) return 'virtual'
  if (specifier[0] === '.' || specifier[0] === '/' || isAbsolute(specifier)) {
    // vite's `cleanUrl` would truncate these into an unresolvable id.
    if (/[#?]/.test(specifier)) return reject('file paths must not contain `#` or `?`')
    return 'path'
  }
  if (BARE_RE.test(specifier)) return 'bare'
  return reject('expected a file path, a bare package specifier, or a `virtual:` id')
}

/** What to check next, per specifier kind — a missing package is the likeliest. */
function advice(kind: SpecifierKind): string {
  if (kind === 'virtual') {
    return (
      '"virtual:" ids must be provided by another plugin’s resolveId hook — ' +
      'is that plugin registered in vite.plugins?'
    )
  }
  if (kind === 'bare') {
    return (
      'Bare specifiers resolve as packages: is the provider package installed, ' +
      'and is the specifier spelled the way the package exports it? A local file ' +
      'needs a "./" prefix to be treated as a path.'
    )
  }
  return (
    'Relative paths resolve against the VitePress project root; for a ' +
    'config-relative file, derive an absolute path from import.meta.url.'
  )
}

/** Npm package name of a bare specifier (`@scope/name` or `name`). */
function packageOf(specifier: string): string {
  const [scope, name] = specifier.split('/')
  return specifier.startsWith('@') && name ? `${scope}/${name}` : scope!
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
