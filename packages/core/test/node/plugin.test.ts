import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { search, type ProviderDefinition } from '../../src/node/index.ts'
import {
  aliasRecord,
  callConfig,
  callConfigResolved,
  callLoad,
  callResolveId,
  fakeSiteConfig,
  loadContext,
  tempDir,
} from './helpers.ts'

const ROOT = '/vp-project'

/** Minimal provider: nothing but the two required fields. */
function provider(over: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return { name: 'fake', clientModule: '@vp-search/fake/adapter', ...over }
}

/** `search()` after `configResolved`, so `base` is the fake project root. */
async function installed(definition: ProviderDefinition, root = ROOT) {
  const plugin = search(definition)
  await callConfigResolved(plugin, { vitepress: fakeSiteConfig({ root }) })
  return plugin
}

describe('plugin shape', () => {
  test('search() returns a vite plugin named vp-search', () => {
    expect(search(provider()).name).toBe('vp-search')
  })

  test('the zero-package escape hatch is a bare definition', async () => {
    const plugin = search({ name: 'custom', clientModule: './my-adapter.ts' })
    expect(plugin.name).toBe('vp-search')
    // No provider.node: the ProviderApi is never built, and nothing throws.
    await callConfigResolved(plugin, { vitepress: fakeSiteConfig() })
    expect(await callConfig(plugin)).toBeTruthy()
  })

  test("declares no enforce, so its config hook runs after VitePress's own", () => {
    expect(search(provider()).enforce).toBeUndefined()
  })
})

describe('clientModule classification (throws while the config loads)', () => {
  test.each([
    ['\0virtual:vp-search/adapter', /bundler-internal/],
    ['./adapter.ts?raw', /must not contain/],
    ['./adapter.ts#frag', /must not contain/],
    ['https://esm.sh/thing', /expected a file path/],
    ['-not-a-package', /expected a file path/],
    ['', /expected a file path/],
  ])('rejects %j', (clientModule, message) => {
    expect(() => search(provider({ clientModule }))).toThrow(message)
    expect(() => search(provider({ clientModule }))).toThrow(/clientModule/)
  })

  test.each(['pkg', '@scope/pkg/sub', './rel.ts', '../up.ts', '/abs.ts', 'virtual:other/adapter'])(
    'accepts %j',
    (clientModule) => {
      expect(() => search(provider({ clientModule }))).not.toThrow()
    },
  )
})

describe('config hook: alias hijack', () => {
  const SPECIFIERS = ['./VPNavBarSearch.vue', './components/VPNavBarSearch.vue']

  test('aliases both VPNavBarSearch specifiers to one real component file', async () => {
    const alias = aliasRecord((await callConfig(search(provider()))).resolve?.alias)

    expect(Object.keys(alias)).toEqual(SPECIFIERS)
    const component = alias[SPECIFIERS[0]!]!
    expect(alias[SPECIFIERS[1]!]).toBe(component)
    expect(component).toMatch(/[\\/]client[\\/]VPNavBarSearch\.vue$/)
    expect(existsSync(component)).toBe(true)
  })

  test('dedupes vue so a linked copy does not get its own', async () => {
    expect((await callConfig(search(provider()))).resolve?.dedupe).toEqual(['vue'])
  })

  test('warns once per specifier already claimed by another plugin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warn.mockRestore())

    await callConfig(search(provider()), {
      resolve: { alias: { './VPNavBarSearch.vue': '/other/Search.vue' } },
    })

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('[vp-search]')
    expect(message).toContain('"./VPNavBarSearch.vue"')
    expect(message).toContain('"/other/Search.vue"')
    expect(message).toContain('last-wins')
  })

  test('warns for both specifiers when both are claimed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warn.mockRestore())

    await callConfig(search(provider()), {
      resolve: { alias: Object.fromEntries(SPECIFIERS.map((s) => [s, '/other/Search.vue'])) },
    })

    expect(warn).toHaveBeenCalledTimes(2)
  })

  test('detects collisions in the array alias form, string and RegExp finds alike', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warn.mockRestore())

    await callConfig(search(provider()), {
      resolve: {
        alias: [{ find: './components/VPNavBarSearch.vue', replacement: '/other/Search.vue' }],
      },
    })
    expect(warn).toHaveBeenCalledTimes(1)

    warn.mockClear()
    await callConfig(search(provider()), {
      resolve: { alias: [{ find: /VPNavBarSearch\.vue$/, replacement: '/other/Search.vue' }] },
    })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  test('stays quiet when the existing alias already points at our component', async () => {
    const plugin = search(provider())
    const component = aliasRecord((await callConfig(plugin)).resolve?.alias)[SPECIFIERS[0]!]!

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warn.mockRestore())

    await callConfig(plugin, {
      resolve: { alias: Object.fromEntries(SPECIFIERS.map((s) => [s, component])) },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  test('stays quiet with no user aliases at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warn.mockRestore())

    await callConfig(search(provider()), {})
    await callConfig(search(provider()), { resolve: {} })
    await callConfig(search(provider()), { resolve: { alias: [] } })

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('config hook: optimizeDeps / ssr hygiene', () => {
  test('excludes core and the provider package, chaining clientDeps under it', async () => {
    const config = await callConfig(
      search(
        provider({ clientModule: '@vp-search/minisearch/adapter', clientDeps: ['minisearch'] }),
      ),
    )

    expect(config.optimizeDeps?.exclude).toEqual(['@vp-search/core', '@vp-search/minisearch'])
    expect(config.optimizeDeps?.include).toEqual(['@vp-search/minisearch > minisearch'])
    expect(config.ssr?.noExternal).toEqual(['@vp-search/core', '@vp-search/minisearch'])
  })

  test('derives the package name from an unscoped bare specifier', async () => {
    const config = await callConfig(
      search(provider({ clientModule: 'my-provider/adapter', clientDeps: ['dep-a', 'dep-b'] })),
    )

    expect(config.optimizeDeps?.exclude).toEqual(['@vp-search/core', 'my-provider'])
    expect(config.optimizeDeps?.include).toEqual(['my-provider > dep-a', 'my-provider > dep-b'])
  })

  test('never lists core twice when clientModule lives in core', async () => {
    const config = await callConfig(
      search(provider({ clientModule: '@vp-search/core/client/custom-adapter.ts' })),
    )

    expect(config.optimizeDeps?.exclude).toEqual(['@vp-search/core'])
  })

  test('omits optimizeDeps.include entirely when there are no clientDeps', async () => {
    const config = await callConfig(search(provider()))

    expect(config.optimizeDeps).toBeDefined()
    expect(config.optimizeDeps && 'include' in config.optimizeDeps).toBe(false)
  })

  test.each(['virtual:other/adapter', './local-adapter.ts'])(
    'degrades clientDeps to plain include entries for %j',
    async (clientModule) => {
      const config = await callConfig(
        search(provider({ clientModule, clientDeps: ['minisearch'] })),
      )

      // No provider package to chain under, and nothing extra to exclude.
      expect(config.optimizeDeps?.include).toEqual(['minisearch'])
      expect(config.optimizeDeps?.exclude).toEqual(['@vp-search/core'])
      expect(config.ssr?.noExternal).toEqual(['@vp-search/core'])
    },
  )
})

describe('resolveId', () => {
  test.each([
    'virtual:vp-search/adapter',
    'virtual:vp-search/options',
    'virtual:vp-search/provider-options',
    'virtual:vp-search/minisearch/manifest',
    'virtual:vp-search/anything/at/all',
  ])('claims %j with the \\0 convention prefix', async (id) => {
    expect(await callResolveId(search(provider()), id)).toBe(`\0${id}`)
  })

  test.each([
    'vue',
    './local.ts',
    'virtual:vp-search',
    'virtual:other/adapter',
    '\0virtual:vp-search/adapter',
  ])('ignores %j', async (id) => {
    expect(await callResolveId(search(provider()), id)).toBeUndefined()
  })
})

describe('load: virtual:vp-search/options', () => {
  test('serializes an empty options object to an empty payload', async () => {
    const code = await callLoad(search(provider()), '\0virtual:vp-search/options')
    expect(code).toBe('export default {}\n')
  })

  test('serializes translations and locales as JSON', async () => {
    const options = {
      translations: { button: { buttonText: 'Find' } },
      locales: { zh: { translations: { button: { buttonText: '搜索' } } } },
    }
    const code = await callLoad(search(provider(), options), '\0virtual:vp-search/options')

    expect(code).toBe(`export default ${JSON.stringify(options)}\n`)
  })

  test('drops keys that are not part of SearchOptions', async () => {
    const code = await callLoad(
      search(provider(), { translations: { button: { buttonText: 'Find' } } }),
      '\0virtual:vp-search/options',
    )

    expect(code).toBe('export default {"translations":{"button":{"buttonText":"Find"}}}\n')
  })

  test('ignores ids without the \\0 prefix', async () => {
    expect(await callLoad(search(provider()), 'virtual:vp-search/options')).toBeUndefined()
    expect(await callLoad(search(provider()), 'vue')).toBeUndefined()
  })
})

describe('load: virtual:vp-search/provider-options', () => {
  const PROVIDER_OPTIONS_ID = '\0virtual:vp-search/provider-options'

  const load = (clientOptions?: unknown) =>
    callLoad(
      search(provider(clientOptions === undefined ? {} : { clientOptions })),
      PROVIDER_OPTIONS_ID,
    )

  test('emits a literal `undefined` when the provider passes no clientOptions', async () => {
    expect(await load()).toBe('export default undefined\n')
  })

  test('serializes JSON values, null included', async () => {
    expect(await load(null)).toBe('export default null\n')
    expect(await load({ apiKey: 'abc', tiers: 2 })).toBe(
      'export default {"apiKey":"abc","tiers":2}\n',
    )
    expect(await load(['a', 'b'])).toBe('export default ["a","b"]\n')
  })
})

describe('load: the null stub', () => {
  test.each([
    'virtual:vp-search/minisearch/manifest',
    'virtual:vp-search/algolia/anything',
    // DESIGN §8b: the fallback covers the whole `virtual:vp-search/` prefix,
    // not just `<provider>/` namespaces.
    'virtual:vp-search/not-a-namespace',
    'virtual:vp-search/deeply/nested/id',
  ])('answers %j so an inactive provider import never 404s', async (id) => {
    expect(await callLoad(search(provider()), `\0${id}`)).toBe('export default null\n')
  })
})

describe('load: virtual:vp-search/adapter', () => {
  const ADAPTER_ID = '\0virtual:vp-search/adapter'

  function expectedCode(emitted: string) {
    return (
      `import create from ${JSON.stringify(emitted)}\n` +
      `import options from "virtual:vp-search/provider-options"\n` +
      `export default create(options)\n`
    )
  }

  test('imports a bare specifier verbatim and instantiates it with provider-options', async () => {
    const plugin = await installed(provider({ clientModule: '@vp-search/fake/adapter' }))
    const ctx = loadContext()

    expect(await callLoad(plugin, ADAPTER_ID, ctx)).toBe(expectedCode('@vp-search/fake/adapter'))
    // Resolved from the project root, as an importer sitting at its index.html.
    expect(ctx.resolve).toHaveBeenCalledWith('@vp-search/fake/adapter', `${ROOT}/index.html`)
  })

  test('emits a virtual: id raw, never pre-resolved', async () => {
    const plugin = await installed(provider({ clientModule: 'virtual:other/adapter' }))
    const ctx = loadContext()

    const code = await callLoad(plugin, ADAPTER_ID, ctx)
    expect(code).toBe(expectedCode('virtual:other/adapter'))
    expect(code).not.toContain('\0')
    expect(ctx.resolve).toHaveBeenCalledWith('virtual:other/adapter', `${ROOT}/index.html`)
  })

  test('resolves a relative path against the VitePress project root, not vite root', async () => {
    const plugin = search(provider({ clientModule: './lib/adapter.ts' }))
    // vite's root is srcDir, which sits inside the content tree when customized.
    await callConfigResolved(plugin, {
      root: `${ROOT}/docs/src`,
      vitepress: fakeSiteConfig({ root: ROOT, srcDir: `${ROOT}/docs/src` }),
    })

    expect(await callLoad(plugin, ADAPTER_ID)).toBe(expectedCode(`${ROOT}/lib/adapter.ts`))
  })

  test('emits an absolute path unchanged', async () => {
    const plugin = await installed(provider({ clientModule: '/elsewhere/adapter.ts' }))

    expect(await callLoad(plugin, ADAPTER_ID)).toBe(expectedCode('/elsewhere/adapter.ts'))
  })

  test('falls back to vite root when the config carries no SiteConfig', async () => {
    const plugin = search(provider({ clientModule: './adapter.ts' }))
    await callConfigResolved(plugin, { root: '/plain-vite' })

    expect(await callLoad(plugin, ADAPTER_ID)).toBe(expectedCode('/plain-vite/adapter.ts'))
  })

  test('reaches a real file next to a real .vitepress directory', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.vitepress'), { recursive: true })
    await writeFile(join(root, 'adapter.ts'), 'export default () => ({ name: "fake" })\n')

    const plugin = await installed(provider({ clientModule: './adapter.ts' }), root)
    const code = await callLoad(plugin, ADAPTER_ID)

    expect(code).toBe(expectedCode(`${root}/adapter.ts`))
    expect(existsSync(join(root, 'adapter.ts'))).toBe(true)
  })

  test('an unresolvable path names the option and the base directory', async () => {
    const plugin = await installed(provider({ clientModule: './missing.ts' }))

    await expect(callLoad(plugin, ADAPTER_ID, loadContext(null))).rejects.toThrow(
      `cannot resolve clientModule "./missing.ts" from ${ROOT}.`,
    )
    await expect(callLoad(plugin, ADAPTER_ID, loadContext(null))).rejects.toThrow(
      /VitePress project root/,
    )
  })

  test('an unresolvable virtual: id points at the plugin that should provide it', async () => {
    const plugin = await installed(provider({ clientModule: 'virtual:other/adapter' }))

    await expect(callLoad(plugin, ADAPTER_ID, loadContext(null))).rejects.toThrow(
      /is that plugin registered in vite\.plugins\?/,
    )
  })

  test('an unresolvable bare specifier still names the option and the base', async () => {
    const plugin = await installed(provider({ clientModule: 'missing-provider/adapter' }))

    await expect(callLoad(plugin, ADAPTER_ID, loadContext(null))).rejects.toThrow(
      `cannot resolve clientModule "missing-provider/adapter" from ${ROOT}.`,
    )
  })

  test('an unresolvable bare specifier is not given relative-path advice', async () => {
    const plugin = await installed(provider({ clientModule: 'missing-provider/adapter' }))
    const error = await callLoad(plugin, ADAPTER_ID, loadContext(null)).catch((e: unknown) => e)

    expect(String(error)).not.toContain('Relative paths resolve against')
    // A missing provider package is the likeliest way to get here.
    expect(String(error)).toContain('is the provider package installed')
  })

  test('a rejecting resolver is treated as unresolvable, not as a crash', async () => {
    const plugin = await installed(provider())
    const ctx = loadContext()
    ctx.resolve.mockRejectedValueOnce(new Error('resolver exploded'))

    await expect(callLoad(plugin, ADAPTER_ID, ctx)).rejects.toThrow(/cannot resolve clientModule/)
  })
})
