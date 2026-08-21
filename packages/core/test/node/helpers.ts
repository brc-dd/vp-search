import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AliasOptions,
  ConfigEnv,
  HookHandler,
  HotUpdateOptions,
  Plugin,
  ResolvedConfig,
  UserConfig,
} from 'vite'
import type { SiteConfig } from 'vitepress'
import { onTestFinished, vi } from 'vitest'

/**
 * Fake contexts for calling plugin hooks directly (vitepress's own test pattern). Nothing here
 * reaches vite; the one real-server test builds its own config.
 */

/** Vite hooks are `ObjectHook`s; ours are declared as plain functions. */
export function hookOf<K extends keyof Plugin>(
  plugin: Plugin,
  name: K,
): HookHandler<NonNullable<Plugin[K]>> {
  type Handler = HookHandler<NonNullable<Plugin[K]>>
  const hook = plugin[name]
  if (typeof hook === 'function') return hook as Handler
  if (hook && typeof hook === 'object' && 'handler' in hook) {
    return (hook as { handler: Handler }).handler
  }
  throw new Error(`[test] plugin has no ${String(name)} hook`)
}

/** Hooks that ignore `this` get this stand-in; `never` satisfies any context. */
const noContext = undefined as never

export type ConfigResult = Omit<UserConfig, 'plugins'>

export async function callConfig(
  plugin: Plugin,
  userConfig: UserConfig = {},
  env: ConfigEnv = { command: 'build', mode: 'production' },
): Promise<ConfigResult> {
  const result = await hookOf(plugin, 'config').call(noContext, userConfig, env)
  if (!result) throw new Error('[test] config hook returned nothing')
  return result
}

/** The plugin only ever returns the object form of `resolve.alias`. */
export function aliasRecord(alias: AliasOptions | undefined): Record<string, string> {
  if (!alias || Array.isArray(alias)) throw new Error('[test] expected an alias record')
  return alias as Record<string, string>
}

export interface ResolvedConfigOptions {
  root?: string
  command?: 'serve' | 'build'
  vitepress?: SiteConfig
}

export function fakeResolvedConfig(options: ResolvedConfigOptions = {}): ResolvedConfig {
  return {
    root: options.root ?? process.cwd(),
    command: options.command ?? 'build',
    ...(options.vitepress && { vitepress: options.vitepress }),
  } as unknown as ResolvedConfig
}

export async function callConfigResolved(
  plugin: Plugin,
  options: ResolvedConfigOptions = {},
): Promise<void> {
  await hookOf(plugin, 'configResolved').call(noContext, fakeResolvedConfig(options))
}

export interface SiteConfigOptions {
  root?: string
  srcDir?: string
  outDir?: string
  /** `site.base`, which `assetsBase` is built from. */
  base?: string
  transformHtml?: SiteConfig['transformHtml']
  buildEnd?: SiteConfig['buildEnd']
}

/** Only the fields the plugin reads; `logger.warn` is a `vi.fn()`. */
export function fakeSiteConfig(options: SiteConfigOptions = {}): SiteConfig {
  const root = options.root ?? '/vp-project'
  return {
    root,
    srcDir: options.srcDir ?? root,
    outDir: options.outDir ?? join(root, '.vitepress', 'dist'),
    site: { base: options.base ?? '/' },
    pages: [],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      warnOnce: vi.fn(),
      error: vi.fn(),
      clearScreen: vi.fn(),
      hasErrorLogged: () => false,
      hasWarned: false,
    },
    ...(options.transformHtml && { transformHtml: options.transformHtml }),
    ...(options.buildEnd && { buildEnd: options.buildEnd }),
  } as unknown as SiteConfig
}

/** `{ pageData, page }` is all `transformHtml` consumers touch. */
export function transformContext(
  page: string,
  pageData: Record<string, unknown> = {},
): Parameters<NonNullable<SiteConfig['transformHtml']>>[2] {
  return {
    page,
    pageData: {
      relativePath: page.replace(/\.html$/, '.md'),
      filePath: page.replace(/\.html$/, '.md'),
      title: 'Title',
      frontmatter: {},
      ...pageData,
    },
  } as unknown as Parameters<NonNullable<SiteConfig['transformHtml']>>[2]
}

export async function callResolveId(plugin: Plugin, id: string): Promise<unknown> {
  return await hookOf(plugin, 'resolveId').call(noContext, id, undefined, { isEntry: false })
}

export interface LoadContext {
  resolve: ReturnType<typeof resolveMock>
  error(message: string): never
}

function resolveMock(result: { id: string } | null) {
  return vi.fn((_source: string, _importer?: string) => Promise.resolve(result))
}

/** `this` for the `load` hook: a resolver that answers, and a throwing `error`. */
export function loadContext(result: { id: string } | null = { id: '/resolved.ts' }): LoadContext {
  return {
    resolve: resolveMock(result),
    error(message) {
      throw new Error(message)
    },
  }
}

export async function callLoad(
  plugin: Plugin,
  id: string,
  ctx: LoadContext = loadContext(),
): Promise<unknown> {
  return await hookOf(plugin, 'load').call(ctx as never, id, undefined)
}

export interface FakeModule {
  id: string
}

export interface HotContext {
  ctx: unknown
  invalidateModule: ReturnType<typeof invalidateMock>
  graph: Map<string, FakeModule>
}

function invalidateMock() {
  return vi.fn((_mod: FakeModule) => {})
}

/** `this` for `hotUpdate`: an environment with a minimal module graph. */
export function hotContext(environmentName = 'client', ids: string[] = []): HotContext {
  const graph = new Map<string, FakeModule>(ids.map((id) => [id, { id }]))
  const invalidateModule = invalidateMock()
  return {
    graph,
    invalidateModule,
    ctx: {
      environment: {
        name: environmentName,
        moduleGraph: {
          getModuleById: (id: string) => graph.get(id),
          invalidateModule,
        },
      },
    },
  }
}

export async function callHotUpdate(
  plugin: Plugin,
  file: string,
  hot: HotContext,
  modules: FakeModule[] = [],
): Promise<unknown> {
  const options = { type: 'update', file, timestamp: 0, modules } as unknown as HotUpdateOptions
  return await hookOf(plugin, 'hotUpdate').call(hot.ctx as never, options)
}

/** Real temp dir (symlinks resolved, so path comparisons hold on macOS). */
export async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'vp-search-')))
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}
