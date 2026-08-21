import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ViteDevServer } from 'vite'
import type { SiteConfig } from 'vitepress'
import { describe, expect, test, vi } from 'vitest'
import {
  search,
  type ProviderApi,
  type ProviderDefinition,
  type ProviderPage,
} from '../../src/node/index.ts'
import {
  callConfigResolved,
  callHotUpdate,
  callLoad,
  fakeSiteConfig,
  hookOf,
  hotContext,
  tempDir,
  transformContext,
  type SiteConfigOptions,
} from './helpers.ts'

/**
 * The ProviderApi is only reachable through `configResolved`, so every test here drives the plugin
 * the way vite does and captures what `setup` receives.
 */
interface Installed {
  plugin: ReturnType<typeof search>
  siteConfig: SiteConfig
  api: ProviderApi
  setup: ReturnType<typeof vi.fn>
}

async function install(
  node: NonNullable<ProviderDefinition['node']>,
  options: { name?: string; command?: 'serve' | 'build'; site?: SiteConfigOptions } = {},
): Promise<Installed> {
  let captured: ProviderApi | undefined
  const setup = vi.fn((_config: SiteConfig, api: ProviderApi) => {
    captured = api
    node.setup?.(_config, api)
  })
  const plugin = search({
    name: options.name ?? 'fake',
    clientModule: '@vp-search/fake/adapter',
    node: { ...node, setup },
  })
  const siteConfig = fakeSiteConfig(options.site ?? {})
  await callConfigResolved(plugin, {
    command: options.command ?? 'build',
    vitepress: siteConfig,
  })
  if (!captured) throw new Error('[test] provider.node.setup never ran')
  return { plugin, siteConfig, api: captured, setup }
}

describe('setup', () => {
  test('runs once, with the SiteConfig and the ProviderApi', async () => {
    const { setup, siteConfig, api } = await install({})

    expect(setup).toHaveBeenCalledTimes(1)
    expect(setup).toHaveBeenCalledWith(siteConfig, api)
  })

  test('is skipped when the resolved config carries no SiteConfig', async () => {
    const setup = vi.fn()
    const plugin = search({ name: 'fake', clientModule: 'pkg/adapter', node: { setup } })
    await callConfigResolved(plugin, { root: '/plain-vite' })

    expect(setup).not.toHaveBeenCalled()
  })

  test('does not run a second time when configResolved fires again', async () => {
    const { plugin, setup, siteConfig } = await install({})
    await callConfigResolved(plugin, { vitepress: siteConfig })

    expect(setup).toHaveBeenCalledTimes(1)
  })
})

describe('api.dev', () => {
  test('is true under vitepress dev', async () => {
    expect((await install({}, { command: 'serve' })).api.dev).toBe(true)
  })

  test('is false during a build', async () => {
    expect((await install({}, { command: 'build' })).api.dev).toBe(false)
  })
})

describe('api.assetsBase', () => {
  test('is the site base plus the vp-search asset subdir', async () => {
    expect((await install({})).api.assetsBase).toBe('/vp-search/')
  })

  test('carries a non-root site base', async () => {
    const { api } = await install({}, { site: { base: '/docs/' } })
    expect(api.assetsBase).toBe('/docs/vp-search/')
  })
})

describe('api.emitAsset', () => {
  test('writes under outDir/vp-search, creating nested directories', async () => {
    const outDir = await tempDir()
    const { api } = await install({}, { site: { outDir } })

    await api.emitAsset('en.content.json', '{"a":1}')
    await api.emitAsset('nested/deep/blob.txt', 'hi')

    expect(await readFile(join(outDir, 'vp-search', 'en.content.json'), 'utf8')).toBe('{"a":1}')
    expect(await readFile(join(outDir, 'vp-search', 'nested', 'deep', 'blob.txt'), 'utf8')).toBe(
      'hi',
    )
  })

  test('accepts binary sources', async () => {
    const outDir = await tempDir()
    const { api } = await install({}, { site: { outDir } })

    await api.emitAsset('bin.dat', new Uint8Array([1, 2, 3]))

    expect([...(await readFile(join(outDir, 'vp-search', 'bin.dat')))]).toEqual([1, 2, 3])
  })

  test('the emitted path lines up with the advertised assetsBase', async () => {
    const outDir = await tempDir()
    const { api } = await install({}, { site: { outDir, base: '/docs/' } })

    await api.emitAsset('manifest.json', '{}')

    expect(api.assetsBase).toBe('/docs/vp-search/')
    // base + fileName is what the client fetches; the subdir must match on disk.
    expect(await readFile(join(outDir, 'vp-search', 'manifest.json'), 'utf8')).toBe('{}')
  })
})

describe('api.addVirtualModule', () => {
  test('registers virtual:vp-search/<provider>/<id>', async () => {
    const { plugin } = await install(
      {
        setup(_config, api) {
          api.addVirtualModule('manifest', () => 'export default {"locales":{}}\n')
        },
      },
      { name: 'minisearch' },
    )

    expect(await callLoad(plugin, '\0virtual:vp-search/minisearch/manifest')).toBe(
      'export default {"locales":{}}\n',
    )
  })

  test('awaits an async loader and re-runs it on every load', async () => {
    let version = 0
    const { plugin } = await install({
      setup(_config, api) {
        api.addVirtualModule('manifest', async () => {
          await Promise.resolve()
          return `export default ${++version}\n`
        })
      },
    })

    expect(await callLoad(plugin, '\0virtual:vp-search/fake/manifest')).toBe('export default 1\n')
    expect(await callLoad(plugin, '\0virtual:vp-search/fake/manifest')).toBe('export default 2\n')
  })

  test('an unregistered id in the namespace loads as a null stub, never a 404', async () => {
    const { plugin } = await install(
      {
        setup(_config, api) {
          api.addVirtualModule('manifest', () => 'export default 1\n')
        },
      },
      { name: 'minisearch' },
    )

    expect(await callLoad(plugin, '\0virtual:vp-search/minisearch/nope')).toBe(
      'export default null\n',
    )
    // A provider that was never installed: its adapter imports still resolve.
    expect(await callLoad(plugin, '\0virtual:vp-search/algolia/manifest')).toBe(
      'export default null\n',
    )
  })

  test('stubs the namespace even when no provider registered anything', async () => {
    const plugin = search({ name: 'fake', clientModule: 'pkg/adapter' })

    expect(await callLoad(plugin, '\0virtual:vp-search/fake/manifest')).toBe(
      'export default null\n',
    )
  })
})

describe('build-hook latches', () => {
  /** A `transformHtml` that appends a marker, so wrapping order is observable. */
  function userHooks() {
    const transformHtml = vi.fn((code: string) => `${code}<!--user-->`)
    const buildEnd = vi.fn(() => Promise.resolve())
    return { transformHtml, buildEnd }
  }

  test('wraps transformHtml once, runs the user hook, and fires every callback', async () => {
    const user = userHooks()
    const pages: ProviderPage[] = []
    const { siteConfig } = await install(
      {
        setup(_config, api) {
          api.onTransformHtml((page) => void pages.push(page))
          api.onTransformHtml((page) => void pages.push(page))
        },
      },
      { site: user },
    )

    expect(siteConfig.transformHtml).not.toBe(user.transformHtml)
    const html = await siteConfig.transformHtml?.(
      '<html></html>',
      '/out/guide.html',
      transformContext('guide.html', { title: 'Guide', frontmatter: { layout: 'doc' } }),
    )

    expect(user.transformHtml).toHaveBeenCalledTimes(1)
    expect(html).toBe('<html></html><!--user-->')
    expect(pages).toHaveLength(2)
    // Callbacks see the user hook's output, not the pre-transform code.
    expect(pages[0]).toEqual({
      relativePath: 'guide.md',
      filePath: 'guide.md',
      title: 'Guide',
      frontmatter: { layout: 'doc' },
      html: '<html></html><!--user-->',
    })
    expect(pages[1]).toEqual(pages[0])
  })

  test('falls back to the original code when the user hook returns nothing', async () => {
    const pages: ProviderPage[] = []
    const { siteConfig } = await install(
      { setup: (_c, api) => api.onTransformHtml((page) => void pages.push(page)) },
      { site: { transformHtml: () => undefined } },
    )

    await siteConfig.transformHtml?.(
      '<html></html>',
      '/out/index.html',
      transformContext('index.html'),
    )

    expect(pages[0]?.html).toBe('<html></html>')
  })

  test('works with no user transformHtml at all', async () => {
    const pages: ProviderPage[] = []
    const { siteConfig } = await install({
      setup: (_c, api) => api.onTransformHtml((page) => void pages.push(page)),
    })

    const html = await siteConfig.transformHtml?.(
      '<p>x</p>',
      '/out/a.html',
      transformContext('a.html'),
    )

    expect(html).toBeUndefined()
    expect(pages[0]?.html).toBe('<p>x</p>')
  })

  test('a throwing callback degrades to a warning and never breaks the page', async () => {
    const seen: string[] = []
    const { siteConfig } = await install({
      setup(_config, api) {
        api.onTransformHtml(() => {
          throw new Error('index blew up')
        })
        api.onTransformHtml((page) => void seen.push(page.relativePath))
      },
    })

    await expect(
      siteConfig.transformHtml?.('<p>x</p>', '/out/a.html', transformContext('a.html')),
    ).resolves.not.toThrow()

    expect(seen).toEqual(['a.md'])
    expect(vi.mocked(siteConfig.logger.warn)).toHaveBeenCalledWith(
      '[vp-search] fake failed to index a.html: index blew up',
    )
  })

  test('wraps buildEnd once, after the user hook, in registration order', async () => {
    const order: string[] = []
    const user = {
      buildEnd: vi.fn(() => {
        order.push('user')
      }),
    }
    const { siteConfig } = await install(
      {
        setup(_config, api) {
          api.onBuildEnd(async () => {
            await Promise.resolve()
            order.push('first')
          })
          api.onBuildEnd(() => void order.push('second'))
        },
      },
      { site: user },
    )

    expect(siteConfig.buildEnd).not.toBe(user.buildEnd)
    await siteConfig.buildEnd?.(siteConfig)

    expect(user.buildEnd).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['user', 'first', 'second'])
  })

  test('a second plugin instance does not re-wrap the same SiteConfig', async () => {
    const user = userHooks()
    const { siteConfig } = await install(
      { setup: (_c, api) => api.onBuildEnd(() => {}) },
      {
        site: user,
      },
    )
    const wrappedOnce = siteConfig.transformHtml
    const wrappedBuildEnd = siteConfig.buildEnd

    const secondRan = vi.fn()
    const second = search({
      name: 'other',
      clientModule: 'pkg/adapter',
      node: { setup: (_c, api) => api.onBuildEnd(secondRan) },
    })
    await callConfigResolved(second, { vitepress: siteConfig })

    // The latch is per-SiteConfig: the hooks stay exactly one layer deep.
    expect(siteConfig.transformHtml).toBe(wrappedOnce)
    expect(siteConfig.buildEnd).toBe(wrappedBuildEnd)

    // The callback arrays are per-plugin-instance, so the second instance's
    // are dropped. Two providers in one site is unsupported (both claim the
    // alias and the adapter virtual) — but it has to fail loudly.
    await siteConfig.buildEnd?.(siteConfig)
    expect(secondRan).not.toHaveBeenCalled()
    expect(vi.mocked(siteConfig.logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining(
        "[vp-search] a second search() plugin is configured for this site, so the other provider's",
      ),
    )
  })

  test('the first instance wraps without any warning', async () => {
    const { siteConfig } = await install({ setup: (_c, api) => api.onBuildEnd(() => {}) })

    expect(vi.mocked(siteConfig.logger.warn)).not.toHaveBeenCalled()
  })

  test('does not shield onBuildEnd callbacks the way it shields page callbacks', async () => {
    const later = vi.fn()
    const { siteConfig } = await install({
      setup(_config, api) {
        api.onBuildEnd(() => Promise.reject(new Error('write failed')))
        api.onBuildEnd(later)
      },
    })

    // Deliberate asymmetry: an indexing error degrades to a per-page warning,
    // but a failed artifact write must fail the build.
    await expect(siteConfig.buildEnd?.(siteConfig)).rejects.toThrow('write failed')
    expect(later).not.toHaveBeenCalled()
    expect(vi.mocked(siteConfig.logger.warn)).not.toHaveBeenCalled()
  })

  test('leaves the hooks alone in dev, where they never fire', async () => {
    const user = userHooks()
    const { siteConfig } = await install(
      {
        setup(_config, api) {
          api.onTransformHtml(() => {})
          api.onBuildEnd(() => {})
        },
      },
      { command: 'serve', site: user },
    )

    expect(siteConfig.transformHtml).toBe(user.transformHtml)
    expect(siteConfig.buildEnd).toBe(user.buildEnd)
  })

  test('leaves the hooks alone when the provider registers no callbacks', async () => {
    const user = userHooks()
    const { siteConfig } = await install({}, { site: user })

    expect(siteConfig.transformHtml).toBe(user.transformHtml)
    expect(siteConfig.buildEnd).toBe(user.buildEnd)
  })
})

describe('configureServer', () => {
  test('hands the provider the server and the api', async () => {
    const configureServer = vi.fn()
    const { plugin, api } = await install({ configureServer }, { command: 'serve' })
    const server = { middlewares: {} } as unknown as ViteDevServer

    await hookOf(plugin, 'configureServer').call(undefined as never, server)

    expect(configureServer).toHaveBeenCalledWith(server, api)
  })

  test('is skipped when there is no ProviderApi', async () => {
    const configureServer = vi.fn()
    const plugin = search({ name: 'fake', clientModule: 'pkg/adapter', node: { configureServer } })

    await hookOf(plugin, 'configureServer').call(undefined as never, {} as unknown as ViteDevServer)

    expect(configureServer).not.toHaveBeenCalled()
  })
})

describe('hotUpdate', () => {
  const MANIFEST = '\0virtual:vp-search/fake/manifest'

  test('invalidates the returned ids and appends them to the update', async () => {
    const hotUpdate = vi.fn(() => ['manifest'])
    const { plugin } = await install({ hotUpdate }, { command: 'serve' })
    const hot = hotContext('client', [MANIFEST])
    const changed = [{ id: '/docs/guide.md' }]

    const result = await callHotUpdate(plugin, '/docs/guide.md', hot, changed)

    expect(hotUpdate).toHaveBeenCalledTimes(1)
    expect(hot.invalidateModule).toHaveBeenCalledWith({ id: MANIFEST })
    expect(result).toEqual([...changed, { id: MANIFEST }])
  })

  test('awaits an async provider hook and passes it the file and the api', async () => {
    const hotUpdate = vi.fn(async () => ['manifest'])
    const { plugin, api } = await install({ hotUpdate }, { command: 'serve' })
    const hot = hotContext('client', [MANIFEST])

    await callHotUpdate(plugin, '/docs/guide.md', hot)

    expect(hotUpdate).toHaveBeenCalledWith('/docs/guide.md', api)
  })

  test.each([[undefined], [[]]])('leaves the update untouched for %j', async (ids) => {
    const { plugin } = await install({ hotUpdate: () => ids }, { command: 'serve' })
    const hot = hotContext('client', [MANIFEST])

    expect(await callHotUpdate(plugin, '/docs/guide.md', hot)).toBeUndefined()
    expect(hot.invalidateModule).not.toHaveBeenCalled()
  })

  test('ignores ids with no module in the graph', async () => {
    const { plugin } = await install({ hotUpdate: () => ['manifest'] }, { command: 'serve' })
    const hot = hotContext('client', [])

    expect(await callHotUpdate(plugin, '/docs/guide.md', hot)).toBeUndefined()
    expect(hot.invalidateModule).not.toHaveBeenCalled()
  })

  test('runs for the client environment only', async () => {
    const hotUpdate = vi.fn(() => ['manifest'])
    const { plugin } = await install({ hotUpdate }, { command: 'serve' })

    expect(
      await callHotUpdate(plugin, '/docs/guide.md', hotContext('ssr', [MANIFEST])),
    ).toBeUndefined()
    expect(hotUpdate).not.toHaveBeenCalled()
  })

  test('is inert for a provider without a hotUpdate hook', async () => {
    const { plugin } = await install({}, { command: 'serve' })
    const hot = hotContext('client', [MANIFEST])

    expect(await callHotUpdate(plugin, '/docs/guide.md', hot)).toBeUndefined()
    expect(hot.invalidateModule).not.toHaveBeenCalled()
  })
})
