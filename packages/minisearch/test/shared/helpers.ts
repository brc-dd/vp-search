/**
 * Artifact builders for the engine tests. Everything here mirrors what the
 * node indexer emits: the real `minisearch` dependency, `createTokenizer` for
 * the artifact's `lang`, and a `JSON.stringify`d index.
 */

import type { MarkedText, SearchResponse, SearchResult } from '@vp-search/core'
import MiniSearch, { type SearchOptions as EngineSearchOptions } from 'minisearch'
import {
  CONTENT_FIELDS,
  CONTENT_STORE_FIELDS,
  TITLES_FIELDS,
  TITLES_STORE_FIELDS,
} from '../../src/fields.ts'
import { createTokenizer } from '../../src/tokenize.ts'
import type { Artifact, IndexRecord } from '../../src/types.ts'

export const LANG = 'en-US'
export const ZH_LANG = 'zh-CN'

/** Long enough that the excerpt window has to elide at both ends. */
export const LONG = [
  'VitePress reads your docs directory and turns every markdown file into a static page.',
  'The default theme ships a navbar, a sidebar, a table of contents and a search box.',
  'Each page is rendered to HTML at build time and then hydration turns it into a Vue application.',
  'Client side routing takes over after the first navigation, so the browser never asks a server for another document.',
  'Anything the renderer produced is indexed, including containers, code groups and included snippets.',
].join(' ')

/**
 * Same shape, in a script with no word spacing — deliberately longer than two
 * excerpt context windows so the character budget actually bites.
 */
export const ZH_LONG = [
  'VitePress 是一个静态站点生成器，专为构建以内容为中心的 docs 网站而设计。',
  '它读取你的文档目录，把每一个 markdown 文件变成一个静态页面。',
  '默认主题提供导航栏、侧边栏、目录和搜索框，并且完全可以自己定制。',
  '每个页面在构建时被渲染成 HTML，然后在浏览器里激活成一个 Vue 应用程序。',
  '首次导航之后，客户端路由接管一切，浏览器不再向服务器请求另一个文档。',
  '渲染器产出的任何内容都会被索引，包括容器、代码组以及被包含进来的片段。',
  '构建结束之后，索引会按语言拆分成若干个带哈希的静态文件，由工作线程按需加载。',
  '这样第一次打开搜索框的时候，只需要下载很小的标题索引就可以立刻开始检索。',
].join('')

export const RECORDS: IndexRecord[] = [
  {
    id: '/guide/index.html#rendering',
    title: 'Rendering',
    titles: ['Guide'],
    text: LONG,
    group: 'Guide',
    kind: 'heading',
  },
  {
    id: '/guide/index.html',
    title: 'Guide',
    titles: [],
    text: 'The docs guide covers installation.',
    group: 'Guide',
    kind: 'page',
  },
  {
    id: '/config/index.html#markdown',
    title: 'Markdown',
    titles: ['Configuration'],
    text: 'Every docs site is configured from a single file.',
    group: 'Reference',
    kind: 'heading',
  },
  {
    id: '/reference/cli.html',
    title: 'Command Line',
    titles: ['Reference'],
    text: 'Run the docs build from any package manager.',
    group: 'Reference',
    kind: 'page',
  },
  {
    id: '/zh/guide/index.html#快速开始',
    title: '快速开始',
    titles: ['指南'],
    text: 'VitePress 是一个静态站点生成器，专为构建以内容为中心的 docs 网站而设计。快速开始只需要几分钟。',
    group: '指南',
    kind: 'heading',
  },
]

export const ZH_RECORDS: IndexRecord[] = [
  {
    id: '/zh/guide/index.html#快速开始',
    title: '快速开始',
    titles: ['指南'],
    text: ZH_LONG,
    group: '指南',
    kind: 'heading',
  },
  {
    id: '/zh/reference/cli.html',
    title: '命令行',
    titles: ['参考'],
    text: '从任意包管理器运行文档构建命令。',
    group: '参考',
    kind: 'page',
  },
]

export interface BuildOptions {
  fields: string[]
  storeFields: string[]
  records?: IndexRecord[]
  lang?: string
  searchOptions?: EngineSearchOptions
}

export function buildArtifact(options: BuildOptions): Artifact {
  const { fields, storeFields, records = RECORDS, lang = LANG, searchOptions } = options
  const engine = new MiniSearch<IndexRecord>({
    fields,
    storeFields,
    idField: 'id',
    tokenize: createTokenizer(lang),
  })
  engine.addAll(records)
  return {
    v: 1,
    lang,
    options: { fields, storeFields, ...(searchOptions && { searchOptions }) },
    index: JSON.stringify(engine),
  }
}

/** The two tiers the indexer emits, from the field split it actually uses. */
export const titlesArtifact = (): Artifact =>
  buildArtifact({ fields: [...TITLES_FIELDS], storeFields: [...TITLES_STORE_FIELDS] })

export const contentArtifact = (): Artifact =>
  buildArtifact({ fields: [...CONTENT_FIELDS], storeFields: [...CONTENT_STORE_FIELDS] })

export const marksOf = (text: MarkedText): string[] =>
  text.filter((segment) => segment.mark).map((segment) => segment.text)

/** `noUncheckedIndexedAccess` makes `results[0]` optional everywhere. */
export function hit(response: SearchResponse, index = 0): SearchResult {
  const result = response.results[index]
  if (!result) throw new Error(`expected a result at index ${index}`)
  return result
}

export function hitFor(response: SearchResponse, url: string): SearchResult {
  const result = response.results.find((candidate) => candidate.url === url)
  if (!result) throw new Error(`expected a result for ${url}`)
  return result
}

export function marked(text: MarkedText | undefined): MarkedText {
  if (!text) throw new Error('expected marked text')
  return text
}
