import { describe, expect, it } from 'vitest'
import { loadTier, runSearch } from '../../src/engine.ts'
import { TITLES_FIELDS, TITLES_STORE_FIELDS } from '../../src/fields.ts'
import type { Artifact as SharedArtifact } from '../../src/types.ts'
import { createIndexer, docId, type Indexer, type PageInput } from '../../src/node/indexer.ts'
import type { Artifact, ArtifactOptions, MinisearchProviderOptions } from '../../src/node/types.ts'
import { body, captureEmits, fakeSiteConfig, page, type FakeSiteOptions } from './helpers.ts'

const BILINGUAL: FakeSiteOptions = {
  locales: { root: { label: 'English', lang: 'en-US' }, zh: { label: '简体中文', lang: 'zh-CN' } },
}

const firstOf = <T>(items: readonly T[]): T => {
  const item = items[0]
  if (item === undefined) throw new Error('empty list')
  return item
}

const PAGES: PageInput[] = [
  page({
    relativePath: 'guide/index.md',
    title: 'Guide',
    html: body('The guide covers installation', 'install', 'Install'),
  }),
  page({
    relativePath: 'config/index.md',
    title: 'Configuration',
    html: body('Every site is configured from one file', 'markdown', 'Markdown'),
  }),
  page({
    relativePath: 'reference/cli.md',
    title: 'Command Line',
    html: body('Run the build from any package manager', 'build', 'Build'),
  }),
]

const ZH_PAGE = page({
  relativePath: 'zh/guide/index.md',
  title: '快速开始',
  html: '<main><p>VitePress 是一个静态站点生成器，专为构建以内容为中心的网站而设计。</p></main>',
})

function indexerWith(
  pages: PageInput[],
  options: MinisearchProviderOptions = {},
  site: FakeSiteOptions = {},
): Indexer {
  const indexer = createIndexer(fakeSiteConfig(site), options)
  for (const input of pages) indexer.index(input)
  return indexer
}

const parse = (json: string): Artifact => JSON.parse(json) as Artifact

const idsInsideIndex = (json: string): string[] =>
  Object.values(
    (JSON.parse(parse(json).index) as { documentIds: Record<string, string> }).documentIds,
  )

describe('determinism', () => {
  it('emits byte-identical artifacts for the same pages indexed twice', () => {
    const first = indexerWith(PAGES)
    const second = indexerWith(PAGES)
    expect(second.artifact('root', 'content')).toBe(first.artifact('root', 'content'))
    expect(second.artifact('root', 'titles')).toBe(first.artifact('root', 'titles'))
  })

  it('does not depend on the order pages arrive in', () => {
    const forwards = indexerWith(PAGES)
    const backwards = indexerWith([...PAGES].reverse())
    expect(backwards.artifact('root', 'content')).toBe(forwards.artifact('root', 'content'))
  })

  it('inserts records in sorted-route order, whatever the input order', () => {
    const ids = idsInsideIndex(indexerWith([...PAGES].reverse()).artifact('root', 'content'))
    expect(ids).toEqual([...ids].sort())
    expect(ids[0]).toBe('/config/')
  })

  it('re-indexing a page in place does not perturb the artifact', () => {
    const indexer = indexerWith(PAGES)
    const before = indexer.artifact('root', 'content')
    indexer.index(PAGES[1] ?? firstOf(PAGES))
    expect(indexer.artifact('root', 'content')).toBe(before)
  })

  it('produces stable hashed filenames across separate runs', async () => {
    const first = captureEmits()
    const second = captureEmits()
    await indexerWith(PAGES).write(first.emit)
    await indexerWith([...PAGES].reverse()).write(second.emit)
    expect([...second.files.keys()]).toEqual([...first.files.keys()])
  })
})

describe('hashes move with content', () => {
  // Stability alone would also hold for a hash that ignored the content, so
  // each of these is the other half of the determinism suite above.
  const namesOf = async (pages: PageInput[], site: FakeSiteOptions = {}) => {
    const { emit } = captureEmits()
    return await indexerWith(pages, {}, site).write(emit)
  }

  const edited = page({
    ...firstOf(PAGES),
    html: body('the guide covers a completely different subject', 'install', 'Install'),
  })

  it('renames the content tier when a page body changes', async () => {
    const before = await namesOf(PAGES)
    const after = await namesOf([edited, ...PAGES.slice(1)])
    expect(after['root']?.content).not.toBe(before['root']?.content)
  })

  it('leaves the titles tier alone for a body-only edit', async () => {
    // Deliberate, not an oversight: the titles tier indexes and stores no body
    // text, so its bytes cannot move. Hashed assets are immutable, and a
    // reader's cached titles tier stays valid across such a deploy.
    const before = await namesOf(PAGES)
    const after = await namesOf([edited, ...PAGES.slice(1)])
    expect(after['root']?.titles).toBe(before['root']?.titles)
  })

  it('renames both tiers when a heading changes', async () => {
    const before = await namesOf(PAGES)
    const after = await namesOf([
      page({ ...firstOf(PAGES), html: body('The guide covers installation', 'setup', 'Setup') }),
      ...PAGES.slice(1),
    ])
    expect(after['root']?.titles).not.toBe(before['root']?.titles)
    expect(after['root']?.content).not.toBe(before['root']?.content)
  })

  it('renames both tiers when a page is added', async () => {
    const before = await namesOf(PAGES)
    const after = await namesOf([
      ...PAGES,
      page({ relativePath: 'guide/extra.md', title: 'Extra', html: body('brand new prose') }),
    ])
    expect(after['root']?.titles).not.toBe(before['root']?.titles)
    expect(after['root']?.content).not.toBe(before['root']?.content)
  })

  it('renames only the locale whose content changed', async () => {
    const before = await namesOf([...PAGES, ZH_PAGE], BILINGUAL)
    const after = await namesOf([edited, ...PAGES.slice(1), ZH_PAGE], BILINGUAL)
    expect(after['root']?.content).not.toBe(before['root']?.content)
    expect(after['zh']?.content).toBe(before['zh']?.content)
    expect(after['zh']?.titles).toBe(before['zh']?.titles)
  })
})

describe('document ids', () => {
  it('drops index.md and rewrites the extension', () => {
    expect(idsInsideIndex(indexerWith(PAGES).artifact('root', 'titles'))).toEqual([
      '/config/',
      '/config/#markdown',
      '/guide/',
      '/guide/#install',
      '/reference/cli.html',
      '/reference/cli.html#build',
    ])
  })

  it('honours cleanUrls', () => {
    const config = fakeSiteConfig({ cleanUrls: true })
    expect(docId(config, 'reference/cli.md')).toBe('/reference/cli')
  })

  it('honours a non-root base', () => {
    const config = fakeSiteConfig({ base: '/docs/' })
    expect(docId(config, 'reference/cli.md')).toBe('/docs/reference/cli.html')
  })

  it('ids a dynamic-route expansion by its expanded route, not its template', () => {
    // VitePress hands `transformHtml` one page per expanded path while
    // `filePath` stays the `[pkg]` template. Indexing after render is what
    // gets these into the index at all (#2939) — and the id has to be the
    // route a reader can actually click.
    const indexer = indexerWith([
      page({
        relativePath: 'packages/foo.md',
        filePath: 'packages/[pkg].md',
        title: 'foo',
        html: body('the foo package', 'usage', 'Usage'),
      }),
    ])
    expect(idsInsideIndex(indexer.artifact('root', 'content'))).toEqual([
      '/packages/foo.html',
      '/packages/foo.html#usage',
    ])
  })

  it('indexes a page whose duplicate heading ids would collide only once', () => {
    const indexer = indexerWith([
      page({
        relativePath: 'dup.md',
        title: 'Dup',
        html: '<main><h2 id="same">One</h2><p>first body</p><h2 id="same">Two</h2><p>second body</p></main>',
      }),
    ])
    expect(indexer.sections('root')).toBe(2)
    expect(idsInsideIndex(indexer.artifact('root', 'content'))).toEqual(['/dup.html#same'])
  })
})

describe('locale bucketing', () => {
  it('lists every configured locale, sorted', () => {
    expect(indexerWith([...PAGES, ZH_PAGE], {}, BILINGUAL).locales()).toEqual(['root', 'zh'])
  })

  it('routes a prefixed page into its own locale bucket', () => {
    const indexer = indexerWith([...PAGES, ZH_PAGE], {}, BILINGUAL)
    expect(idsInsideIndex(indexer.artifact('zh', 'content'))).toEqual(['/zh/guide/'])
    expect(idsInsideIndex(indexer.artifact('root', 'content'))).not.toContain('/zh/guide/')
  })

  it('records the locale lang on its artifact', () => {
    const indexer = indexerWith([...PAGES, ZH_PAGE], {}, BILINGUAL)
    expect(indexer.lang('zh')).toBe('zh-CN')
    expect(parse(indexer.artifact('zh', 'content')).lang).toBe('zh-CN')
    expect(parse(indexer.artifact('root', 'content')).lang).toBe('en-US')
  })

  it('keeps a configured but empty locale in the list', () => {
    expect(indexerWith(PAGES, {}, BILINGUAL).locales()).toContain('zh')
    expect(indexerWith(PAGES, {}, BILINGUAL).sections('zh')).toBe(0)
  })
})

describe('frontmatter', () => {
  it('skips a page marked search: false', () => {
    const indexer = indexerWith([
      page({ relativePath: 'secret.md', frontmatter: { search: false } }),
      ...PAGES,
    ])
    expect(idsInsideIndex(indexer.artifact('root', 'content'))).not.toContain('/secret.html')
  })

  it('un-indexes a page that gains search: false on re-index', () => {
    const indexer = indexerWith(PAGES)
    const before = indexer.sections('root')
    indexer.index(page({ ...firstOf(PAGES), frontmatter: { search: false } }))
    expect(indexer.sections('root')).toBeLessThan(before)
  })

  it('drops a page whose content extracts to nothing', () => {
    const indexer = indexerWith([page({ relativePath: 'empty.md', html: '<main>   </main>' })])
    expect(indexer.sections('root')).toBe(0)
  })
})

describe('extraFields', () => {
  const options: MinisearchProviderOptions = { extraFields: [{ name: 'tags', boost: 5 }] }
  const tagged = page({
    relativePath: 'guide/tags.md',
    title: 'Tagged',
    frontmatter: { tags: ['cli', 'build'], author: { name: 'nobody' } },
    html: body('a tagged page', 'tags', 'Tags'),
  })

  it('adds the field to the content tier only', () => {
    const indexer = indexerWith([tagged], options)
    expect(parse(indexer.artifact('root', 'content')).options).toEqual({
      fields: ['title', 'titles', 'group', 'text', 'tags'],
      storeFields: ['title', 'titles', 'group', 'kind', 'text', 'tags'],
      searchOptions: { boost: { tags: 5 } },
    } satisfies ArtifactOptions)
    expect(parse(indexer.artifact('root', 'titles')).options.fields).toEqual([
      'title',
      'titles',
      'group',
    ])
  })

  it('flattens an array frontmatter value and ignores object values', () => {
    const stored = JSON.parse(
      parse(indexerWith([tagged], options).artifact('root', 'content')).index,
    ) as { storedFields: Record<string, Record<string, unknown>> }
    const record = Object.values(stored.storedFields)[0]
    expect(record?.['tags']).toBe('cli build')
    expect(record).not.toHaveProperty('author')
  })

  it('makes the extra field searchable', () => {
    const indexer = indexerWith([tagged, ...PAGES], options)
    const tier = loadTier(parse(indexer.artifact('root', 'content')) as unknown as SharedArtifact)
    expect(runSearch({ content: tier }, 'cli').results[0]?.url).toContain('/guide/tags.html')
  })

  it('lets user searchOptions win over an extra field boost of the same name', () => {
    const indexer = indexerWith([tagged], {
      extraFields: [{ name: 'tags', boost: 5 }],
      searchOptions: { fuzzy: 0.1, boost: { tags: 9, title: 3 } },
    })
    expect(parse(indexer.artifact('root', 'content')).options.searchOptions).toEqual({
      fuzzy: 0.1,
      boost: { tags: 9, title: 3 },
    })
  })

  it('omits searchOptions entirely when nothing configures it', () => {
    expect(parse(indexerWith(PAGES).artifact('root', 'content')).options).not.toHaveProperty(
      'searchOptions',
    )
  })
})

describe('tier field split', () => {
  it('indexes titles without text and stores no text on the titles tier', () => {
    expect(parse(indexerWith(PAGES).artifact('root', 'titles')).options).toEqual({
      fields: [...TITLES_FIELDS],
      storeFields: [...TITLES_STORE_FIELDS],
    } satisfies ArtifactOptions)
  })

  it('adds text to both fields and storeFields on the content tier', () => {
    expect(parse(indexerWith(PAGES).artifact('root', 'content')).options).toEqual({
      fields: ['title', 'titles', 'group', 'text'],
      storeFields: ['title', 'titles', 'group', 'kind', 'text'],
    } satisfies ArtifactOptions)
  })

  it('indexes group on both tiers, so the upgrade never loses a hit', () => {
    const indexer = indexerWith(PAGES)
    expect(parse(indexer.artifact('root', 'titles')).options.fields).toContain('group')
    expect(parse(indexer.artifact('root', 'content')).options.fields).toContain('group')
  })

  it('stamps the artifact version', () => {
    expect(parse(indexerWith(PAGES).artifact('root', 'titles')).v).toBe(1)
  })
})

describe('searchOptions carry data, never code (#3685)', () => {
  // MiniSearch's own `searchOptions` accept functions (`processTerm`,
  // `tokenize`); the artifact is JSON, so anything code-valued silently
  // vanishes in transit. Better that it never claims to survive.
  const withFunction: MinisearchProviderOptions = {
    searchOptions: { fuzzy: 0.3, processTerm: (term: string) => term.toLowerCase() },
  }

  it('drops a function-valued searchOption from the emitted artifact', () => {
    const json = indexerWith(PAGES, withFunction).artifact('root', 'content')
    expect(json).not.toContain('processTerm')
    expect(parse(json).options.searchOptions).toEqual({ fuzzy: 0.3 })
  })

  it('keeps the data-valued siblings of a dropped function', () => {
    const json = indexerWith(PAGES, withFunction).artifact('root', 'titles')
    expect(parse(json).options.searchOptions?.['fuzzy']).toBe(0.3)
  })
})

describe('group resolution', () => {
  const site: FakeSiteOptions = {
    themeConfig: {
      sidebar: [{ text: 'Guide <b>new</b>', items: [{ text: 'Overview', link: '/guide/' }] }],
    },
  }

  it('stores the sidebar group, HTML stripped', () => {
    const stored = JSON.parse(
      parse(indexerWith(PAGES, {}, site).artifact('root', 'titles')).index,
    ) as { storedFields: Record<string, Record<string, unknown>> }
    const groups = Object.values(stored.storedFields).map((record) => record['group'])
    expect(groups).toContain('Guide new')
  })

  it('leaves group off records with no sidebar match', () => {
    const stored = JSON.parse(
      parse(indexerWith(PAGES, {}, site).artifact('root', 'titles')).index,
    ) as { storedFields: Record<string, Record<string, unknown>> }
    const cli = Object.entries(stored.storedFields).find(
      ([, record]) => record['title'] === 'Build',
    )
    expect(cli?.[1]).not.toHaveProperty('group')
  })
})

describe('write', () => {
  it('emits one hashed file per tier per locale plus the manifest', async () => {
    const { emit, files } = captureEmits()
    const manifest = await indexerWith([...PAGES, ZH_PAGE], {}, BILINGUAL).write(emit)

    expect([...files.keys()].sort()).toEqual(
      [
        manifest['root']?.titles,
        manifest['root']?.content,
        manifest['zh']?.titles,
        manifest['zh']?.content,
        'manifest.json',
      ].sort(),
    )
  })

  it('names artifacts <locale>.<tier>.<hash>.json', async () => {
    const { emit } = captureEmits()
    const manifest = await indexerWith(PAGES).write(emit)
    expect(manifest['root']?.titles).toMatch(/^root\.titles\.[0-9a-f]{8}\.json$/)
    expect(manifest['root']?.content).toMatch(/^root\.content\.[0-9a-f]{8}\.json$/)
  })

  it('records lang and section count per locale', async () => {
    const { emit } = captureEmits()
    const indexer = indexerWith([...PAGES, ZH_PAGE], {}, BILINGUAL)
    const manifest = await indexer.write(emit)

    expect(manifest['root']?.lang).toBe('en-US')
    expect(manifest['zh']).toMatchObject({ lang: 'zh-CN', sections: 1 })
    expect(manifest['root']?.sections).toBe(indexer.sections('root'))
  })

  it('writes the manifest file with the same content it returns', async () => {
    const { emit, files } = captureEmits()
    const manifest = await indexerWith(PAGES).write(emit)
    expect(JSON.parse(files.get('manifest.json') ?? '{}')).toEqual(manifest)
  })
})

describe('round trip through the emitted artifact', () => {
  it('finds a per-page term at the right id', async () => {
    const { emit, files } = captureEmits()
    const manifest = await indexerWith([...PAGES, ZH_PAGE], {}, BILINGUAL).write(emit)
    const json = files.get(manifest['root']?.content ?? '')
    const tier = loadTier(JSON.parse(json ?? '') as SharedArtifact)

    const response = runSearch({ content: tier }, 'installation')
    expect(response.results[0]?.url).toBe('/guide/')
    expect(response.results[0]?.excerpt).toBeDefined()
  })

  it('finds the zh record through the artifact tokenizer', async () => {
    const { emit, files } = captureEmits()
    const manifest = await indexerWith([...PAGES, ZH_PAGE], {}, BILINGUAL).write(emit)
    const tier = loadTier(
      JSON.parse(files.get(manifest['zh']?.content ?? '') ?? '') as SharedArtifact,
    )

    // '生成器' only exists inside an unspaced run; it is findable because the
    // artifact carries lang zh-CN and the worker rebuilds the same segmenter.
    expect(runSearch({ content: tier }, '生成器').results[0]?.url).toBe('/zh/guide/')
  })

  it('answers title queries from the titles tier with no excerpt', async () => {
    const { emit, files } = captureEmits()
    const manifest = await indexerWith(PAGES).write(emit)
    const tier = loadTier(
      JSON.parse(files.get(manifest['root']?.titles ?? '') ?? '') as SharedArtifact,
    )

    const response = runSearch({ titles: tier }, 'markdown')
    expect(response.results[0]?.url).toBe('/config/#markdown')
    expect(response.results[0]?.excerpt).toBeUndefined()
  })
})

describe('bookkeeping', () => {
  it('counts records per locale', () => {
    expect(indexerWith(PAGES).sections('root')).toBe(6)
  })

  it('forgets a removed page', () => {
    const indexer = indexerWith(PAGES)
    indexer.remove('guide/index.md')
    expect(indexer.sections('root')).toBe(4)
    expect(idsInsideIndex(indexer.artifact('root', 'content'))).not.toContain('/guide/')
  })

  it('ignores removal of a page that was never indexed', () => {
    const indexer = indexerWith(PAGES)
    indexer.remove('nope.md')
    expect(indexer.sections('root')).toBe(6)
  })
})

describe('extraction failures', () => {
  // `index()` deliberately does not catch: the guard that warns and skips a
  // failing page lives one layer up, in wrapBuildHooks
  // (packages/core/src/node/index.ts), which wraps every provider callback.
  it('propagates an unusable content selector rather than swallowing it', () => {
    const indexer = createIndexer(fakeSiteConfig(), { contentSelector: 'main[' })
    expect(() => indexer.index(firstOf(PAGES))).toThrow()
  })

  it('leaves the index usable after a page throws', () => {
    const indexer = createIndexer(fakeSiteConfig(), {})
    indexer.index(firstOf(PAGES))
    const broken = createIndexer(fakeSiteConfig(), { contentSelector: 'main[' })
    expect(() => broken.index(firstOf(PAGES))).toThrow()
    expect(indexer.sections('root')).toBe(2)
  })
})
