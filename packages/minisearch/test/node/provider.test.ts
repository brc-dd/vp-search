/**
 * `minisearch()` itself — the node half of the ProviderDefinition. Everything
 * here drives the provider through the public `ProviderApi` the core plugin
 * hands it (recorded, not real: core's own wiring is covered by
 * `packages/core/test/node/provider-api.test.ts`), so a change to the contract
 * shows up as a signature failure rather than a silent no-op.
 *
 * The dev paths need `createDevIndexer`'s renderer, so `createMarkdownRenderer`
 * and `readFile` are mocked the same way `dev.test.ts` mocks them.
 */

import type { ProviderApi, ProviderPage } from '@vp-search/core/node'
import type { ViteDevServer } from 'vite'
import type { SiteConfig } from 'vitepress'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { minisearch } from '../../src/index.ts'
import type { IndexData } from '../../src/types.ts'
import { fakeSiteConfig, type FakeSiteOptions } from './helpers.ts'

const SRC_DIR = '/docs'

const mocks = vi.hoisted(() => {
  const sources = new Map<string, string>()
  // no node:path in a hoisted factory; the src dir is a fixed literal
  const keyOf = (file: string): string => (file.startsWith('/docs/') ? file.slice(6) : file)

  const renderAsync = vi.fn(async (src: string, env: Record<string, unknown>) => {
    env['frontmatter'] = {}
    return `<p>${src}</p>`
  })

  const createMarkdownRenderer = vi.fn(async (..._args: unknown[]) => ({ renderAsync }))

  const readFile = vi.fn(async (file: unknown) => {
    const source = sources.get(keyOf(String(file)))
    if (source === undefined) throw new Error(`ENOENT: ${String(file)}`)
    return source
  })

  return { sources, renderAsync, createMarkdownRenderer, readFile }
})

vi.mock('vitepress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vitepress')>()
  return {
    ...actual,
    createMarkdownRenderer: mocks.createMarkdownRenderer,
  } as unknown as typeof actual
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: mocks.readFile } as unknown as typeof actual
})

/** What core's `createProviderApi` gives a provider, with every call recorded.
 * Ids arrive here unnamespaced — core prefixes `virtual:vp-search/minisearch/`
 * on its side, so the provider only ever passes the bare id. */
interface Recorded {
  api: ProviderApi
  virtuals: Map<string, () => string | Promise<string>>
  pageCallbacks: Array<(page: ProviderPage) => void>
  buildEndCallbacks: Array<() => Promise<void> | void>
  emitted: Map<string, string>
}

function recordApi(dev: boolean, base = '/'): Recorded {
  const virtuals = new Map<string, () => string | Promise<string>>()
  const pageCallbacks: Array<(page: ProviderPage) => void> = []
  const buildEndCallbacks: Array<() => Promise<void> | void> = []
  const emitted = new Map<string, string>()
  return {
    virtuals,
    pageCallbacks,
    buildEndCallbacks,
    emitted,
    api: {
      dev,
      assetsBase: `${base}vp-search/`,
      onTransformHtml: (cb) => void pageCallbacks.push(cb),
      onBuildEnd: (cb) => void buildEndCallbacks.push(cb),
      addVirtualModule: (id, load) => void virtuals.set(id, load),
      emitAsset: async (fileName, source) => void emitted.set(fileName, String(source)),
    },
  }
}

interface Middleware {
  (req: { url?: string }, res: FakeResponse, next: (error?: unknown) => void): void
}

interface FakeResponse {
  setHeader: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

const fakeResponse = (): FakeResponse => ({ setHeader: vi.fn(), end: vi.fn() })

interface Installed {
  provider: ReturnType<typeof minisearch>
  siteConfig: SiteConfig
  recorded: Recorded
  /** Loads the registered `manifest` virtual module and parses its payload. */
  manifest(): Promise<IndexData>
  middlewares: Middleware[]
  hotUpdate(file: string): Promise<string[] | void>
}

function install(
  options: Parameters<typeof minisearch>[0] = {},
  { dev = false, site = {} }: { dev?: boolean; site?: FakeSiteOptions } = {},
): Installed {
  const provider = minisearch(options)
  const siteConfig = fakeSiteConfig({ srcDir: SRC_DIR, ...site })
  const recorded = recordApi(dev, siteConfig.site.base)
  provider.node?.setup?.(siteConfig, recorded.api)

  const middlewares: Middleware[] = []
  const server = {
    middlewares: { use: (fn: Middleware) => void middlewares.push(fn) },
  } as unknown as ViteDevServer
  provider.node?.configureServer?.(server, recorded.api)

  return {
    provider,
    siteConfig,
    recorded,
    middlewares,
    async manifest() {
      const load = recorded.virtuals.get('manifest')
      if (!load) throw new Error('[test] no manifest virtual module was registered')
      const code = await load()
      expect(code.startsWith('export default ')).toBe(true)
      expect(code.endsWith('\n')).toBe(true)
      return JSON.parse(code.slice('export default '.length)) as IndexData
    },
    hotUpdate: async (file) => (await provider.node?.hotUpdate?.(file, recorded.api)) ?? undefined,
  }
}

/** Runs the middleware chain over one url and reports what happened. */
async function request(installed: Installed, url: string) {
  const res = fakeResponse()
  const next = vi.fn()
  for (const middleware of installed.middlewares) middleware({ url }, res, next)
  await vi.waitFor(() => {
    expect(next.mock.calls.length + res.end.mock.calls.length).toBeGreaterThan(0)
  })
  return { res, next, body: res.end.mock.calls[0]?.[0] as string | undefined }
}

beforeEach(() => {
  mocks.sources.clear()
  mocks.sources.set('guide.md', '# Guide')
  mocks.sources.set('config.md', '# Config')
})

describe('definition', () => {
  it('names itself after the engine and points at its own adapter', () => {
    const provider = minisearch()
    expect(provider.name).toBe('minisearch')
    expect(provider.clientModule).toBe('@vp-search/minisearch/adapter')
  })

  it('declares minisearch as a client dep so the dev cold-open does not waterfall', () => {
    expect(minisearch().clientDeps).toEqual(['minisearch'])
  })

  it('carries no clientOptions: the adapter reads the virtual manifest instead', () => {
    expect(minisearch()).not.toHaveProperty('clientOptions')
  })

  it('participates in all three node hooks', () => {
    const node = minisearch().node
    expect(node?.setup).toBeTypeOf('function')
    expect(node?.configureServer).toBeTypeOf('function')
    expect(node?.hotUpdate).toBeTypeOf('function')
  })
})

describe('setup: build', () => {
  it('registers the build hooks and the manifest module', () => {
    const { recorded } = install()
    expect(recorded.pageCallbacks).toHaveLength(1)
    expect(recorded.buildEndCallbacks).toHaveLength(1)
    expect([...recorded.virtuals.keys()]).toEqual(['manifest'])
  })

  it('indexes the pages transformHtml hands it and writes them at buildEnd', async () => {
    const { recorded } = install()
    recorded.pageCallbacks[0]?.({
      relativePath: 'guide/index.md',
      filePath: 'guide/index.md',
      title: 'Guide',
      frontmatter: {},
      html: '<main><p>the guide covers installation</p></main>',
    })
    await recorded.buildEndCallbacks[0]?.()

    const names = [...recorded.emitted.keys()]
    expect(names).toContain('manifest.json')
    expect(names.some((name) => /^root\.titles\.[0-9a-f]{8}\.json$/.test(name))).toBe(true)
    expect(names.some((name) => /^root\.content\.[0-9a-f]{8}\.json$/.test(name))).toBe(true)
  })

  it('ids a dynamic-route expansion by its expanded route (#2939)', async () => {
    // The `transformHtml` seam is the whole reason indexing runs after render:
    // `relativePath` is the expanded path while `filePath` stays the template.
    const { recorded } = install()
    recorded.pageCallbacks[0]?.({
      relativePath: 'packages/foo.md',
      filePath: 'packages/[pkg].md',
      title: 'foo',
      frontmatter: {},
      html: '<main><p>the foo package</p></main>',
    })
    await recorded.buildEndCallbacks[0]?.()

    const artifact = [...recorded.emitted.entries()].find(([name]) => name.includes('.content.'))
    expect(artifact?.[1]).toContain('/packages/foo.html')
  })
})

describe('setup: dev', () => {
  it('registers no build hooks', () => {
    const { recorded } = install({}, { dev: true })
    expect(recorded.pageCallbacks).toEqual([])
    expect(recorded.buildEndCallbacks).toEqual([])
    expect([...recorded.virtuals.keys()]).toEqual(['manifest'])
  })
})

describe('the manifest virtual module', () => {
  it('defers the locale map to a fetched manifest.json in a build', async () => {
    expect(await install().manifest()).toEqual({
      base: '/vp-search/',
      locales: null,
      manifest: 'manifest.json',
    })
  })

  it('carries a non-root site base into the build payload', async () => {
    const payload = await install({}, { site: { base: '/docs/' } }).manifest()
    expect(payload.base).toBe('/docs/vp-search/')
  })

  it('inlines every locale in dev, version-busted, off the synthetic dev path', async () => {
    const installed = install({}, { dev: true, site: { pages: ['guide.md', 'config.md'] } })
    expect(await installed.manifest()).toEqual({
      base: '/@vp-search/',
      manifest: null,
      locales: {
        root: {
          lang: 'en-US',
          titles: 'root.titles.json?v=0',
          content: 'root.content.json?v=0',
          sections: 2,
        },
      },
    })
  })

  it('inlines one entry per configured locale', async () => {
    const installed = install(
      {},
      {
        dev: true,
        site: {
          pages: ['guide.md', 'zh/guide.md'],
          locales: {
            root: { label: 'English', lang: 'en-US' },
            zh: { label: '简体中文', lang: 'zh-CN' },
          },
        },
      },
    )
    mocks.sources.set('zh/guide.md', '# 指南')

    const payload = await installed.manifest()
    expect(Object.keys(payload.locales ?? {})).toEqual(['root', 'zh'])
    expect(payload.locales?.['zh']?.lang).toBe('zh-CN')
  })

  it('scans the site before answering, so the section counts are real', async () => {
    const installed = install({}, { dev: true, site: { pages: ['guide.md'] } })
    expect(mocks.renderAsync).not.toHaveBeenCalled()

    await installed.manifest()
    expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
  })
})

describe('configureServer: the dev artifact middleware', () => {
  const devSite: FakeSiteOptions = { pages: ['guide.md'] }

  it('serves a known locale tier as no-cache json', async () => {
    const installed = install({}, { dev: true, site: devSite })
    const { res, next, body } = await request(installed, '/@vp-search/root.titles.json?v=0')

    expect(next).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json')
    expect(res.setHeader).toHaveBeenCalledWith('cache-control', 'no-cache')
    expect(JSON.parse(body ?? '{}')).toMatchObject({ v: 1, lang: 'en-US' })
  })

  it('serves the content tier too', async () => {
    const installed = install({}, { dev: true, site: devSite })
    const { body } = await request(installed, '/@vp-search/root.content.json')
    expect(JSON.parse(body ?? '{}').options.fields).toContain('text')
  })

  it('nexts an unknown locale rather than inventing an artifact', async () => {
    const installed = install({}, { dev: true, site: devSite })
    const { res, next } = await request(installed, '/@vp-search/zh.titles.json')

    expect(next).toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })

  it.each([
    '/guide.html',
    '/@vp-search/root.json',
    '/@vp-search/root.titles.jsonx',
    '/vp-search/root.titles.json',
  ])('nexts a non-matching url %j', async (url) => {
    const installed = install({}, { dev: true, site: devSite })
    const { res, next } = await request(installed, url)

    expect(next).toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })

  it('nexts everything during a build, where there is no dev indexer', async () => {
    const installed = install({}, { dev: false, site: devSite })
    const { res, next } = await request(installed, '/@vp-search/root.titles.json')

    expect(next).toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })
})

describe('hotUpdate', () => {
  const devSite: FakeSiteOptions = { pages: ['guide.md', 'config.md'] }

  it('invalidates the manifest module when a page changes', async () => {
    const installed = install({}, { dev: true, site: devSite })
    await installed.manifest()

    expect(await installed.hotUpdate('/docs/guide.md')).toEqual(['manifest'])
  })

  it('bumps the version the manifest payload hands the client', async () => {
    const installed = install({}, { dev: true, site: devSite })
    expect((await installed.manifest()).locales?.['root']?.titles).toBe('root.titles.json?v=0')

    await installed.hotUpdate('/docs/guide.md')
    expect((await installed.manifest()).locales?.['root']?.titles).toBe('root.titles.json?v=1')
    expect((await installed.manifest()).locales?.['root']?.content).toBe('root.content.json?v=1')
  })

  it('ignores a .md file that is not a page — includes and route templates', async () => {
    const installed = install({}, { dev: true, site: devSite })
    await installed.manifest()

    expect(await installed.hotUpdate('/docs/parts/snippet.md')).toBeUndefined()
    expect((await installed.manifest()).locales?.['root']?.titles).toBe('root.titles.json?v=0')
  })

  it.each(['/docs/guide.vue', '/docs/.vitepress/config.ts', '/docs/public/logo.svg'])(
    'ignores the non-markdown file %j',
    async (file) => {
      const installed = install({}, { dev: true, site: devSite })
      await installed.manifest()

      expect(await installed.hotUpdate(file)).toBeUndefined()
    },
  )

  it('reports nothing before search is first opened, so no scan is forced', async () => {
    const installed = install({}, { dev: true, site: devSite })

    expect(await installed.hotUpdate('/docs/guide.md')).toBeUndefined()
    expect(mocks.renderAsync).not.toHaveBeenCalled()
  })

  it('does nothing during a build', async () => {
    const installed = install({}, { dev: false, site: devSite })
    expect(await installed.hotUpdate('/docs/guide.md')).toBeUndefined()
  })
})
