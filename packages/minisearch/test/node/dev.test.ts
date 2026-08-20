import { mergeMarkdownLocales, type DefaultTheme, type SiteConfig } from 'vitepress'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDevIndexer } from '../../src/node/dev.ts'
import { createIndexer, type Indexer } from '../../src/node/indexer.ts'
import type { Artifact } from '../../src/node/types.ts'
import { fakeSiteConfig, type FakeSiteOptions, type TestLogger } from './helpers.ts'

/**
 * `createDevIndexer` builds its own renderer via `createMarkdownRenderer`, so
 * the only way to reach its seams — scan/HMR bookkeeping, locale routing,
 * frontmatter titles, the `<main>` wrapper, the render-failure guard — is to
 * mock that factory and `readFile`.
 *
 * Deliberately NOT covered here, and left to the e2e lane: the real markdown
 * pipeline (shiki, containers, unrendered Vue components), the dev middleware
 * that serves artifacts, and the `hotUpdate` → virtual-module invalidation
 * round trip. None of those exist without a running VitePress dev server.
 */

const SRC_DIR = '/docs'

const mocks = vi.hoisted(() => {
  interface Source {
    markdown: string
    html?: string
    frontmatter?: Record<string, unknown>
    /** What the renderer would set on `env.title` from the first heading. */
    title?: string
    fail?: boolean
  }

  const sources = new Map<string, Source>()
  // no node:path in a hoisted factory; the src dir is a fixed literal
  const keyOf = (file: string): string => (file.startsWith('/docs/') ? file.slice(6) : file)

  const renderAsync = vi.fn(async (src: string, env: Record<string, unknown>) => {
    const source = sources.get(keyOf(String(env['path'])))
    if (!source) throw new Error(`no source for ${String(env['path'])}`)
    if (source.fail) throw new Error('render exploded')
    env['frontmatter'] = source.frontmatter ?? {}
    if (source.title !== undefined) env['title'] = source.title
    return source.html ?? `<p>${src}</p>`
  })

  // typed loosely on purpose: the argument tuple is what one test asserts on
  const createMarkdownRenderer = vi.fn(async (..._args: unknown[]) => ({ renderAsync }))

  const readFile = vi.fn(async (file: unknown) => {
    const source = sources.get(keyOf(String(file)))
    if (!source) throw new Error(`ENOENT: no such file or directory, open '${String(file)}'`)
    return source.markdown
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

interface Setup {
  dev: ReturnType<typeof createDevIndexer>
  indexer: Indexer
  logger: TestLogger
  config: SiteConfig<DefaultTheme.Config>
}

function setup(pages: string[], site: FakeSiteOptions = {}): Setup {
  const logger: TestLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    warnOnce: vi.fn(),
    clearScreen: vi.fn(),
    hasErrorLogged: () => false,
    hasWarned: false,
  }
  const config = fakeSiteConfig({ srcDir: SRC_DIR, pages, logger, ...site })
  const indexer = createIndexer(config, {})
  return { dev: createDevIndexer(config, indexer), indexer, logger, config }
}

const idsOf = (indexer: Indexer, locale = 'root'): string[] =>
  Object.values(
    (
      JSON.parse((JSON.parse(indexer.artifact(locale, 'content')) as Artifact).index) as {
        documentIds: Record<string, string>
      }
    ).documentIds,
  )

beforeEach(() => {
  mocks.sources.clear()
  mocks.sources.set('guide.md', { markdown: '# Guide', title: 'Guide' })
  mocks.sources.set('config.md', { markdown: '# Config', title: 'Config' })
})

describe('first scan', () => {
  it('indexes every page in siteConfig.pages', async () => {
    const { dev, indexer } = setup(['guide.md', 'config.md'])
    await dev.ready()

    expect(idsOf(indexer).sort()).toEqual(['/config.html', '/guide.html'])
  })

  it('runs once, however often ready is awaited', async () => {
    const { dev } = setup(['guide.md', 'config.md'])
    await Promise.all([dev.ready(), dev.ready()])
    await dev.ready()

    expect(mocks.renderAsync).toHaveBeenCalledTimes(2)
  })

  it('skips resolved dynamic routes instead of warning ENOENT on them', async () => {
    // `pages` lists resolved dynamic routes, but no source file exists for
    // them in dev — the documented production-only slice of the index.
    const { dev, indexer, logger } = setup(['guide.md', 'guide/alfa.md'], {
      dynamicRoutes: [{ route: 'guide/[pkg].md', path: 'guide/alfa.md' }],
    })
    await dev.ready()

    expect(idsOf(indexer)).toEqual(['/guide.html'])
    expect(logger.warn).not.toHaveBeenCalled()
    expect(mocks.readFile).not.toHaveBeenCalledWith('/docs/guide/alfa.md')
  })

  it('builds the markdown renderer once for the whole scan', async () => {
    const { dev } = setup(['guide.md', 'config.md'])
    await dev.ready()

    expect(mocks.createMarkdownRenderer).toHaveBeenCalledTimes(1)
  })

  it('asks for the renderer with the locale-merged markdown options (#5350)', async () => {
    // The renderer is a process-wide singleton shared with markdownToVue:
    // whoever builds it first decides its options for everyone, so asking with
    // the raw `siteConfig.markdown` would strip per-locale markdown config off
    // the real pipeline. The merged form is the whole point of the call.
    const { dev, config } = setup(['guide.md'], {
      markdown: { lineNumbers: true },
      locales: {
        root: { label: 'English', lang: 'en-US' },
        zh: { label: '简体中文', lang: 'zh-CN', markdown: { lineNumbers: false } },
      },
    })
    await dev.ready()

    const args = mocks.createMarkdownRenderer.mock.calls[0]
    expect(args).toEqual([
      config.srcDir,
      mergeMarkdownLocales(config.markdown, config.site.locales),
      config.site.base,
      config.logger,
      config.publicDir,
    ])
    // not the raw options: the zh override has to be in there
    expect(args?.[1]).not.toBe(config.markdown)
    expect(args?.[1]).toEqual({ lineNumbers: true, locales: { zh: { lineNumbers: false } } })
  })

  it('wraps the rendered body in <main> so contentSelector still matches', async () => {
    // the stub returns a bare `<p>`; without the wrapper nothing would index
    mocks.sources.set('guide.md', { markdown: 'x', html: '<p>hydration and routing</p>' })
    const { dev, indexer } = setup(['guide.md'])
    await dev.ready()

    expect(indexer.sections('root')).toBe(1)
  })

  it('does not scan anything when the site has no pages', async () => {
    const { dev } = setup([])
    await dev.ready()

    expect(mocks.renderAsync).not.toHaveBeenCalled()
  })
})

describe('titles', () => {
  it('prefers a frontmatter title over the rendered one', async () => {
    mocks.sources.set('guide.md', {
      markdown: 'x',
      title: 'Rendered',
      frontmatter: { title: 'Frontmatter' },
    })
    const { dev, indexer } = setup(['guide.md'])
    await dev.ready()

    expect(indexer.artifact('root', 'titles')).toContain('Frontmatter')
    expect(indexer.artifact('root', 'titles')).not.toContain('Rendered')
  })

  it('falls back to the title the renderer put on env', async () => {
    mocks.sources.set('guide.md', { markdown: 'x', title: 'Rendered' })
    const { dev, indexer } = setup(['guide.md'])
    await dev.ready()

    expect(indexer.artifact('root', 'titles')).toContain('Rendered')
  })

  it('tolerates a page with no title at all', async () => {
    mocks.sources.set('guide.md', { markdown: 'x', html: '<p>body only</p>' })
    const { dev, indexer } = setup(['guide.md'])
    await dev.ready()

    expect(idsOf(indexer)).toEqual(['/guide.html'])
  })
})

describe('locale routing', () => {
  const bilingual: FakeSiteOptions = {
    locales: {
      root: { label: 'English', lang: 'en-US' },
      zh: { label: '简体中文', lang: 'zh-CN' },
    },
  }

  it('routes a prefixed page into its own locale bucket', async () => {
    mocks.sources.set('zh/guide.md', { markdown: 'x', title: '指南' })
    const { dev, indexer } = setup(['guide.md', 'zh/guide.md'], bilingual)
    await dev.ready()

    expect(idsOf(indexer, 'zh')).toEqual(['/zh/guide.html'])
    expect(idsOf(indexer, 'root')).toEqual(['/guide.html'])
  })

  it('passes the resolved localeIndex to the renderer env', async () => {
    mocks.sources.set('zh/guide.md', { markdown: 'x', title: '指南' })
    const { dev } = setup(['zh/guide.md'], bilingual)
    await dev.ready()

    expect(mocks.renderAsync).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ localeIndex: 'zh', relativePath: 'zh/guide.md' }),
    )
  })
})

describe('rewrites', () => {
  it('indexes under the rewritten route while reading the source file', async () => {
    mocks.sources.set('src/guide.md', { markdown: 'x', title: 'Guide' })
    const { dev, indexer } = setup(['src/guide.md'], {
      rewrites: { 'src/guide.md': 'guide.md' },
    })
    await dev.ready()

    expect(idsOf(indexer)).toEqual(['/guide.html'])
    expect(mocks.readFile).toHaveBeenCalledWith('/docs/src/guide.md', 'utf-8')
  })
})

describe('per-file re-index', () => {
  it('reports nothing to update before the first scan', async () => {
    const { dev } = setup(['guide.md'])

    await expect(dev.update('guide.md')).resolves.toBe(false)
    expect(mocks.renderAsync).not.toHaveBeenCalled()
  })

  it('re-renders only the changed page after a scan', async () => {
    const { dev } = setup(['guide.md', 'config.md'])
    await dev.ready()
    mocks.renderAsync.mockClear()

    await expect(dev.update('guide.md')).resolves.toBe(true)
    expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
    expect(mocks.renderAsync).toHaveBeenCalledWith(
      '# Guide',
      expect.objectContaining({ relativePath: 'guide.md' }),
    )
  })

  it('replaces the records of a page rather than appending to them', async () => {
    const { dev, indexer } = setup(['guide.md'])
    await dev.ready()
    const before = indexer.sections('root')

    mocks.sources.set('guide.md', {
      markdown: 'x',
      title: 'Guide',
      html: '<p>brand new prose</p><h2 id="added">Added</h2><p>more</p>',
    })
    await dev.update('guide.md')

    expect(indexer.sections('root')).toBe(before + 1)
    expect(idsOf(indexer).sort()).toEqual(['/guide.html', '/guide.html#added'])
  })

  it('drops the page when its new content is marked search: false', async () => {
    const { dev, indexer } = setup(['guide.md'])
    await dev.ready()

    mocks.sources.set('guide.md', { markdown: 'x', frontmatter: { search: false } })
    await dev.update('guide.md')

    expect(indexer.sections('root')).toBe(0)
  })
})

describe('failure isolation', () => {
  it('warns and skips a page that fails to render', async () => {
    mocks.sources.set('broken.md', { markdown: 'x', fail: true })
    const { dev, indexer, logger } = setup(['guide.md', 'broken.md'])

    await expect(dev.ready()).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('minisearch failed to index broken.md'),
    )
    expect(idsOf(indexer)).toEqual(['/guide.html'])
  })

  it('warns and skips a page whose file is missing', async () => {
    const { dev, logger } = setup(['guide.md', 'ghost.md'])
    await dev.ready()

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ghost.md'))
  })

  it('keeps HMR working after a failed render', async () => {
    mocks.sources.set('broken.md', { markdown: 'x', fail: true })
    const { dev, indexer } = setup(['broken.md'])
    await dev.ready()

    mocks.sources.set('broken.md', { markdown: 'x', title: 'Fixed', html: '<p>now fine</p>' })
    await expect(dev.update('broken.md')).resolves.toBe(true)
    expect(idsOf(indexer)).toEqual(['/broken.html'])
  })
})
