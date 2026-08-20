/**
 * Throwaway verification for src/adapters/minisearch/core.ts.
 * Builds a hand-made artifact pair with MiniSearch + the shared tokenizer,
 * then drives the worker's pure core without a browser.
 */
const REPO = '/Users/divyansh/vitepress-any-search'

const { default: MiniSearch } = await import(`${REPO}/node_modules/minisearch/dist/es/index.js`)
const { createTokenizer } = await import(`${REPO}/src/local/tokenize.ts`)
const { loadTier, runSearch, excerpt } = await import(`${REPO}/src/adapters/minisearch/core.ts`)
const { textOf } = await import(`${REPO}/src/highlight.ts`)

type Seg = { text: string; mark?: boolean }

const LANG = 'en-US'

const LONG = [
  'VitePress reads your docs directory and turns every markdown file into a static page.',
  'The default theme ships a navbar, a sidebar, a table of contents and a search box.',
  'Each page is rendered to HTML at build time and then hydration turns it into a Vue application.',
  'Client side routing takes over after the first navigation, so the browser never asks a server for another document.',
  'Anything the renderer produced is indexed, including containers, code groups and included snippets.',
].join(' ')

const RECORDS = [
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

function build(fields: string[], storeFields: string[], searchOptions?: object) {
  const engine = new MiniSearch({
    fields,
    storeFields,
    idField: 'id',
    tokenize: createTokenizer(LANG),
  })
  engine.addAll(RECORDS)
  return {
    v: 1,
    lang: LANG,
    options: { fields, storeFields, searchOptions },
    index: JSON.stringify(engine),
  }
}

const titlesArtifact = build(['title', 'titles'], ['title', 'titles', 'group', 'kind'])
const contentArtifact = build(
  ['title', 'titles', 'text'],
  ['title', 'titles', 'text', 'group', 'kind'],
)

const titles = loadTier(titlesArtifact)
const content = loadTier(contentArtifact)
const both = { titles, content }

let failed = 0
function check(label: string, ok: unknown, detail?: unknown) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (detail !== undefined && (!ok || process.env.VERBOSE)) {
    console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
}
const marks = (segs: Seg[]) => segs.filter((s) => s.mark).map((s) => s.text)
const show = (segs: Seg[]) => segs.map((s) => (s.mark ? `[${s.text}]` : s.text)).join('')

console.log('\n— artifact sizes —')
console.log(
  `titles index ${titlesArtifact.index.length} B, content index ${contentArtifact.index.length} B`,
)

console.log('\n— tier selection —')
const empty = runSearch({}, 'docs')
check(
  'no tier loaded returns an empty, exact response',
  empty.results.length === 0 && empty.total?.count === 0,
  empty,
)

const titlesOnly = runSearch({ titles }, 'guide')
check(
  'titles tier answers before content arrives',
  titlesOnly.results.length > 0,
  titlesOnly.results.map((r) => r.url),
)
check(
  'titles tier carries no excerpt (text is not stored)',
  titlesOnly.results.every((r) => r.excerpt === undefined),
)
check('titles tier does not match body text', runSearch({ titles }, 'docs').results.length === 0)
check('content tier supersedes titles once loaded', runSearch(both, 'docs').results.length === 5)

console.log('\n— totals and cap —')
const all = runSearch(both, 'docs')
check('total counts every hit before the cap', all.total?.count === 5, all.total)
check('total is exact', all.total?.exact === true)
const capped = runSearch(both, 'docs', 2)
check(
  'limit caps results, not the total',
  capped.results.length === 2 && capped.total?.count === 5,
  {
    results: capped.results.length,
    total: capped.total,
  },
)
check('default limit is 12', runSearch(both, 'docs').results.length === Math.min(5, 12))
check(
  'ordering is MiniSearch’s own (scores descend)',
  capped.results[0]!.score! >= capped.results[1]!.score!,
  capped.results.map((r) => [r.url, r.score]),
)

console.log('\n— result mapping —')
const guide = runSearch(both, 'markdown').results[0]!
check(
  'url is the record id (anchor included)',
  guide.url === '/config/index.html#markdown',
  guide.url,
)
check('group passes through', guide.group === 'Reference', guide.group)
check('kind passes through', guide.kind === 'heading', guide.kind)
check('score is present', typeof guide.score === 'number')
check('elapsedMs is reported', typeof all.elapsedMs === 'number', all.elapsedMs)

console.log('\n— marks —')
const config = runSearch(both, 'config').results.find(
  (r) => r.url === '/config/index.html#markdown',
)!
check(
  'prefix match marks the whole document term in titles',
  marks(config.titles![0]!).includes('Configuration'),
  show(config.titles![0]!),
)
check(
  'body match is marked in the excerpt',
  marks(config.excerpt!).includes('configured'),
  show(config.excerpt!),
)
const rendering = runSearch(both, 'rendering').results[0]!
check(
  'title marks land on the matched term',
  marks(rendering.title).includes('Rendering'),
  show(rendering.title),
)
const fuzzy = runSearch(both, 'markdwon').results[0]
check(
  'fuzzy match still marks the document term',
  fuzzy !== undefined && marks(fuzzy.title).includes('Markdown'),
  fuzzy && show(fuzzy.title),
)

console.log('\n— excerpt windowing —')
const deep = runSearch(both, 'hydration').results[0]!
const deepText = textOf(deep.excerpt!)
check('window elides both ends', deepText.startsWith('…') && deepText.endsWith('…'), deepText)
check(
  'window is far shorter than the section text',
  deepText.length < LONG.length / 2,
  `${deepText.length} of ${LONG.length} chars`,
)
check('window keeps context on both sides of the match', /\S+ hydration \S+/i.test(deepText))
check(
  'the match itself is marked inside the window',
  marks(deep.excerpt!).includes('hydration'),
  show(deep.excerpt!),
)
const short = runSearch(both, 'installation').results[0]!
check('short text is not elided', !textOf(short.excerpt!).includes('…'), show(short.excerpt!))
check(
  'leading ellipsis only when the window starts late',
  textOf(runSearch(both, 'snippets').results[0]!.excerpt!).startsWith('…'),
  show(runSearch(both, 'snippets').results[0]!.excerpt!),
)
check(
  'unmatched body still yields a lead-in excerpt',
  textOf(excerpt(LONG, ['absent'])).startsWith('VitePress reads'),
  show(excerpt(LONG, ['absent'])),
)

console.log('\n— CJK via the shared tokenizer —')
const zh = runSearch(both, '快速开始')
check(
  'zh query matches the zh record',
  zh.results[0]?.url === '/zh/guide/index.html#快速开始',
  zh.results.map((r) => r.url),
)
check('zh title is marked', marks(zh.results[0]!.title).length > 0, show(zh.results[0]!.title))
check(
  'zh excerpt is marked',
  marks(zh.results[0]!.excerpt!).length > 0,
  show(zh.results[0]!.excerpt!),
)
const zhPartial = runSearch(both, '生成器')
check(
  'segmented interior word is searchable',
  zhPartial.results[0]?.url === '/zh/guide/index.html#快速开始',
  zhPartial.results.map((r) => r.url),
)
check(
  'zh excerpt stays bounded by the char budget',
  textOf(zh.results[0]!.excerpt!).length <= 121 + 2,
  textOf(zh.results[0]!.excerpt!).length,
)

console.log('\n— search options —')
check(
  'parity defaults are applied',
  JSON.stringify(titles.searchOptions) ===
    JSON.stringify({ fuzzy: 0.2, prefix: true, boost: { title: 4, text: 2, titles: 1 } }),
  titles.searchOptions,
)
const tuned = loadTier(
  build(['title', 'titles', 'text'], ['title', 'text'], { fuzzy: false, boost: { title: 9 } }),
)
check(
  'artifact searchOptions win, boost merges per field',
  JSON.stringify(tuned.searchOptions) ===
    JSON.stringify({ fuzzy: false, prefix: true, boost: { title: 9, text: 2, titles: 1 } }),
  tuned.searchOptions,
)

console.log('\n— sample payload —')
console.log(JSON.stringify(runSearch(both, 'config', 2), null, 2))

console.log(`\n${failed ? `${failed} FAILED` : 'all checks passed'}`)
process.exit(failed ? 1 : 0)
