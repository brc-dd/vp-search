/**
 * Smoke test for what `pnpm build` actually emits. The workspace `exports`
 * maps point at `src/` and only flip to `dist/` at pack time, so every other
 * suite exercises the sources; these tests import the built files DIRECTLY by
 * relative path, which is the only way the published artifact gets covered.
 * (h3's `dist.test.ts` pattern — the bug that motivated it was a bundler
 * dropping a side-effect check, so the published package behaved differently
 * from its source.)
 *
 * Bare specifiers *inside* dist still resolve to workspace `src/` here; that is
 * fine, the subject is the emitted module, not its dependencies.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'

const PACKAGES = fileURLToPath(new URL('../../packages/', import.meta.url))
const NAMES = ['core', 'minisearch', 'algolia']
const SFCS = ['VPMarkedText', 'VPNavBarSearch', 'VPSearchBox']

const short = (file: string) => relative(PACKAGES, file).replaceAll(sep, '/')

/** Lazy: nothing may stat `dist/` at collection time, or a clean checkout
 * would fail instead of skip. */
function distFiles(): string[] {
  return NAMES.flatMap((name) => {
    const dist = join(PACKAGES, name, 'dist')
    return readdirSync(dist, { recursive: true, encoding: 'utf8' })
      .map((entry) => join(dist, entry))
      .filter((file) => statSync(file).isFile())
  })
}

interface PackageJson {
  publishConfig?: { exports?: Record<string, unknown> }
}

/** The `./dist/*.js` targets each package promises at pack time. */
function publishedEntries(name: string): string[] {
  const pkg = JSON.parse(readFileSync(join(PACKAGES, name, 'package.json'), 'utf8')) as PackageJson
  return Object.values(pkg.publishConfig?.exports ?? {})
    .filter((target): target is string => typeof target === 'string' && target.endsWith('.js'))
    .map((target) => join(PACKAGES, name, target))
}

const BUILT = existsSync(join(PACKAGES, 'core/dist/index.js'))
const SUITE = BUILT
  ? 'dist entry smoke'
  : 'dist entry smoke — SKIPPED: packages/*/dist is missing, run `pnpm build` first'

describe.skipIf(!BUILT)(SUITE, () => {
  describe('@vp-search/core', () => {
    test('index exposes exactly the expected runtime exports', async () => {
      const core = await import('../../packages/core/dist/index.js')
      expect(Object.keys(core).sort()).toEqual([
        'createSearchTranslate',
        'defaultTranslations',
        'defineSearchAdapter',
        'fromRanges',
        'fromTagged',
        'fromTerms',
        'interpolate',
        'plain',
        'textOf',
        'unescapeEntities',
      ])
    })

    test('highlight helpers behave', async () => {
      const { fromRanges, fromTagged, fromTerms, plain, textOf, unescapeEntities } =
        await import('../../packages/core/dist/index.js')
      expect(plain('abc')).toEqual([{ text: 'abc' }])
      expect(plain('')).toEqual([])
      expect(textOf([{ text: 'ab' }, { text: 'cd', mark: true }])).toBe('abcd')
      expect(fromRanges('abcd', [{ start: 1, end: 3 }])).toEqual([
        { text: 'a' },
        { text: 'bc', mark: true },
        { text: 'd' },
      ])
      expect(fromTagged('a<b>c</b>d', '<b>', '</b>')).toEqual([
        { text: 'a' },
        { text: 'c', mark: true },
        { text: 'd' },
      ])
      expect(fromTerms('Hello world', ['world'])).toEqual([
        { text: 'Hello ' },
        { text: 'world', mark: true },
      ])
      expect(unescapeEntities('a &amp; b &#x2014; c')).toBe('a & b — c')
    })

    test('defineSearchAdapter is identity', async () => {
      const { defineSearchAdapter } = await import('../../packages/core/dist/index.js')
      const adapter = { name: 'test', search: () => ({ results: [] }) }
      expect(defineSearchAdapter(adapter)).toBe(adapter)
    })

    test('translation helpers resolve through locale, root, then defaults', async () => {
      const { createSearchTranslate, defaultTranslations } =
        await import('../../packages/core/dist/index.js')
      expect(defaultTranslations.modal?.title).toBe('Search')
      const t = createSearchTranslate(
        { locales: { zh: { translations: { button: { buttonText: '搜索' } } } } },
        'zh',
      )
      expect(t('button.buttonText')).toBe('搜索')
      expect(t('modal.footer.selectText')).toBe('to select')
    })

    // the default strings carry `{count}`/`{query}` placeholders, so anyone
    // building a UI on `createSearchTranslate` needs it
    test('index re-exports interpolate', async () => {
      const core = await import('../../packages/core/dist/index.js')
      expect(core).toHaveProperty('interpolate', expect.any(Function))
    })

    test('node entry: search() returns the vite plugin', async () => {
      const { search } = await import('../../packages/core/dist/node/index.js')
      expect(search).toBeTypeOf('function')
      const plugin = search({ name: 'test', clientModule: '@vp-search/minisearch/adapter' })
      expect(plugin.name).toBe('vp-search')
      for (const hook of [
        'config',
        'configResolved',
        'resolveId',
        'load',
        'configureServer',
        'hotUpdate',
      ]) {
        expect(plugin).toHaveProperty(hook, expect.any(Function))
      }
    })

    test('node entry: search() rejects a malformed clientModule eagerly', async () => {
      const { search } = await import('../../packages/core/dist/node/index.js')
      expect(() =>
        search({ name: 'test', clientModule: 'https://cdn.example/adapter.js' }),
      ).toThrow(/clientModule/)
    })
  })

  describe('@vp-search/minisearch', () => {
    test('minisearch() returns a ProviderDefinition', async () => {
      const { minisearch } = await import('../../packages/minisearch/dist/index.js')
      const provider = minisearch()
      expect(provider.name).toBe('minisearch')
      expect(provider.clientModule).toBe('@vp-search/minisearch/adapter')
      expect(provider.clientDeps).toEqual(['minisearch'])
      expect(provider.node?.setup).toBeTypeOf('function')
      expect(provider.node?.configureServer).toBeTypeOf('function')
      expect(provider.node?.hotUpdate).toBeTypeOf('function')
    })

    test('engine: loadTier + runSearch round-trip on a hand-built artifact', async () => {
      const { loadTier, runSearch } = await import('../../packages/minisearch/dist/engine.js')
      const { createTokenizer } = await import('../../packages/minisearch/dist/tokenize.js')
      const { textOf } = await import('../../packages/core/dist/index.js')

      // The real dependency, resolved the way the built worker resolves it.
      const MiniSearch = createRequire(join(PACKAGES, 'minisearch/package.json'))(
        'minisearch',
      ) as new (options: Record<string, unknown>) => { addAll(records: readonly object[]): void }

      const LANG = 'en-US'
      const records = [
        {
          id: '/guide/index.html#install',
          title: 'Install',
          titles: ['Guide'],
          text: 'Install vp-search with the package manager of your choice.',
          group: 'Guide',
          kind: 'heading',
        },
        {
          id: '/guide/index.html',
          title: 'Guide',
          titles: [],
          text: 'The guide covers configuration.',
          group: 'Guide',
          kind: 'page',
        },
      ]
      const build = (fields: string[], storeFields: string[]) => {
        const engine = new MiniSearch({
          fields,
          storeFields,
          idField: 'id',
          tokenize: createTokenizer(LANG),
        })
        engine.addAll(records)
        return {
          v: 1 as const,
          lang: LANG,
          options: { fields, storeFields },
          index: JSON.stringify(engine),
        }
      }

      const titles = loadTier(build(['title', 'titles'], ['title', 'titles', 'group', 'kind']))
      const content = loadTier(
        build(['title', 'titles', 'text'], ['title', 'titles', 'text', 'group', 'kind']),
      )
      // VitePress local-search parity defaults survive the build
      expect(titles.searchOptions).toEqual({
        fuzzy: 0.2,
        prefix: true,
        boost: { title: 4, text: 2, titles: 1 },
      })

      expect(runSearch({}, 'install')).toEqual({ results: [], total: { count: 0, exact: true } })

      const early = runSearch({ titles }, 'install')
      expect(early.results.map((result) => result.url)).toEqual(['/guide/index.html#install'])
      expect(early.results[0]?.excerpt).toBeUndefined()
      // the titles tier does not index body text
      expect(runSearch({ titles }, 'configuration').results).toEqual([])

      const full = runSearch({ titles, content }, 'configuration')
      expect(full.total).toEqual({ count: 1, exact: true })
      expect(full.elapsedMs).toBeTypeOf('number')
      const hit = full.results[0]
      expect(hit?.url).toBe('/guide/index.html')
      expect(hit?.group).toBe('Guide')
      expect(hit?.kind).toBe('page')
      expect(textOf(hit?.excerpt ?? [])).toBe('The guide covers configuration.')
      expect((hit?.excerpt ?? []).filter((segment) => segment.mark)).toEqual([
        { text: 'configuration', mark: true },
      ])
    })

    test('tokenize: createTokenizer segments text', async () => {
      const { createTokenizer } = await import('../../packages/minisearch/dist/tokenize.js')
      expect(createTokenizer('en-US')('Hello, brave new world!')).toEqual([
        'Hello',
        'brave',
        'new',
        'world',
      ])
    })

    test('adapter constructs without spawning a worker', async () => {
      const adapterModule = await import('../../packages/minisearch/dist/adapter.js')
      // never call load/search here: both reach for a real Worker
      const adapter = adapterModule.minisearchAdapter()
      expect(adapter.name).toBe('minisearch')
      expect(adapter.load).toBeTypeOf('function')
      expect(adapter.search).toBeTypeOf('function')
      expect(adapter.onInvalidate).toBeTypeOf('function')
      expect(adapter.dispose).toBeTypeOf('function')
      expect(adapterModule.default).toBe(adapterModule.minisearchAdapter)
    })
  })

  describe('@vp-search/algolia', () => {
    test('algolia() returns a ProviderDefinition carrying the client options', async () => {
      const { algolia } = await import('../../packages/algolia/dist/index.js')
      const options = { appId: 'APP', apiKey: 'KEY', indexName: 'docs' }
      const provider = algolia(options)
      expect(provider.name).toBe('algolia')
      expect(provider.clientModule).toBe('@vp-search/algolia/adapter')
      expect(provider.clientOptions).toEqual(options)
      expect(provider.node).toBeUndefined()
    })

    test('algoliaAdapter constructs with attribution and preconnect', async () => {
      const adapterModule = await import('../../packages/algolia/dist/adapter.js')
      const adapter = adapterModule.algoliaAdapter({
        appId: 'APP',
        apiKey: 'KEY',
        indexName: 'docs',
      })
      expect(adapter.name).toBe('algolia')
      expect(adapter.attribution).toEqual({ label: 'Algolia', url: 'https://www.algolia.com' })
      expect(adapter.preconnect).toEqual(['https://APP-dsn.algolia.net'])
      expect(adapterModule.default).toBe(adapterModule.algoliaAdapter)
    })

    test('adapter search rejects cleanly on a non-ok response', async () => {
      const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
        Promise.resolve(
          new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
        ),
      )
      vi.stubGlobal('fetch', fetchMock)

      const { algoliaAdapter } = await import('../../packages/algolia/dist/adapter.js')
      const adapter = algoliaAdapter({ appId: 'APP', apiKey: 'KEY', indexName: 'docs' })
      await expect(adapter.search('vite', {})).rejects.toThrow(
        'Algolia request failed: 429 rate limited',
      )

      const call = fetchMock.mock.calls[0]
      expect(call?.[0]).toBe('https://APP-dsn.algolia.net/1/indexes/docs/query')
      expect(call?.[1]?.method).toBe('POST')
      expect(call?.[1]?.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': 'APP',
        'X-Algolia-API-Key': 'KEY',
      })
      // the sentinel highlight tags the adapter asks the backend for
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        query: 'vite',
        highlightPreTag: '\u0002',
        highlightPostTag: '\u0003',
      })
    })
  })

  describe('eager module graph', () => {
    /**
     * What a `<script type="module">` would pull in before running a line of
     * this file: static `import`/`export … from`, bare side-effect imports
     * included. Dynamic `import(…)` is deliberately not counted — deferring a
     * dependency to a call is the whole point of the shapes asserted below.
     */
    function staticImports(file: string): string[] {
      const code = readFileSync(file, 'utf8')
      const fromClause = /(?:^|[;\s])(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/g
      const sideEffect = /(?:^|[;\s])import\s+(['"])([^'"]+)\1/g
      return [...code.matchAll(fromClause), ...code.matchAll(sideEffect)].map((match) => match[2]!)
    }

    test('the minisearch adapter never statically imports the engine', () => {
      // The §3 payload claim: opening a page costs the adapter, not MiniSearch.
      // The engine is behind `new Worker(new URL('./worker.js', …))`, which a
      // bundler follows into a separate chunk and a browser fetches only when
      // the worker starts.
      const file = join(PACKAGES, 'minisearch/dist/adapter.js')
      expect(staticImports(file)).toEqual(['@vp-search/core'])
      expect(readFileSync(file, 'utf8')).toMatch(
        /new Worker\(new URL\((['"])\.\/worker\.js\1,\s*import\.meta\.url\)/,
      )
    })

    test('the worker is where the engine dependency actually lands', () => {
      // The other half: if `minisearch` stopped being reachable from the worker
      // graph the test above would still pass while search silently broke.
      const graph = ['worker.js', 'engine.js'].flatMap((name) =>
        staticImports(join(PACKAGES, 'minisearch/dist', name)),
      )
      expect(graph).toContain('minisearch')
    })

    test('the algolia adapter imports nothing outside @vp-search/core', () => {
      // Dep-free by construction (DESIGN §8): plain `fetch`, no algoliasearch
      // client, no DocSearch UI bundle — not even a lazy one.
      const file = join(PACKAGES, 'algolia/dist/adapter.js')
      expect(staticImports(file)).toEqual(['@vp-search/core'])
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bimport\s*\(/)
    })
  })

  describe('emitted files', () => {
    test('no source `.ts` specifier survives in the emitted output', () => {
      const offenders: string[] = []
      for (const file of distFiles()) {
        if (!/\.(js|ts|vue)$/.test(file)) continue
        for (const [match] of readFileSync(file, 'utf8').matchAll(/(['"])(\.[^'"]*?)\.ts\1/g)) {
          offenders.push(`${short(file)}: ${match}`)
        }
      }
      expect(offenders).toEqual([])
    })

    test('every relative `new URL(…, import.meta.url)` resolves inside dist', () => {
      const found: string[] = []
      for (const file of distFiles()) {
        if (!/\.(js|vue)$/.test(file)) continue
        const code = readFileSync(file, 'utf8')
        for (const match of code.matchAll(/new URL\((['"])(\.[^'"]+)\1,\s*import\.meta\.url\)/g)) {
          const specifier = match[2]!
          found.push(`${short(file)} -> ${specifier}`)
          expect(
            existsSync(resolve(dirname(file), specifier)),
            `${short(file)} -> ${specifier}`,
          ).toBe(true)
        }
      }
      // the rewrites `sourceAssets` performs; both point at emitted siblings
      expect(found.sort()).toEqual([
        'core/dist/node/index.js -> ../client/VPNavBarSearch.vue',
        'minisearch/dist/adapter.js -> ./worker.js',
      ])
    })

    test('every published entry exists with a sibling declaration', () => {
      for (const name of NAMES) {
        const entries = publishedEntries(name)
        expect(entries.length, name).toBeGreaterThan(0)
        for (const entry of entries) {
          expect(existsSync(entry), short(entry)).toBe(true)
          expect(existsSync(entry.replace(/\.js$/, '.d.ts')), short(entry)).toBe(true)
        }
      }
    })

    test('every emitted chunk ships a sibling declaration', () => {
      const missing = distFiles()
        .filter((file) => file.endsWith('.js') && !existsSync(file.replace(/\.js$/, '.d.ts')))
        .map(short)
      expect(missing).toEqual([])
    })

    test('dist SFCs ship `.d.vue.ts` declarations', () => {
      for (const name of SFCS) {
        const sfc = join(PACKAGES, 'core/dist/client', `${name}.vue`)
        expect(existsSync(sfc), short(sfc)).toBe(true)
        const types = join(PACKAGES, 'core/dist/client', `${name}.d.vue.ts`)
        expect(existsSync(types), short(types)).toBe(true)
      }
    })
  })
})
