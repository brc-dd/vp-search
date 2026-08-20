/**
 * Throwaway verification for src/adapters/minisearch/worker.ts — the protocol
 * shell, driven in Node with `self` and `fetch` stubbed.
 */
const REPO = '/Users/divyansh/vitepress-any-search'

const { default: MiniSearch } = await import(`${REPO}/node_modules/minisearch/dist/es/index.js`)
const { createTokenizer } = await import(`${REPO}/src/local/tokenize.ts`)

function artifact(lang: string, records: object[], fields: string[], storeFields: string[]) {
  const engine = new MiniSearch({
    fields,
    storeFields,
    idField: 'id',
    tokenize: createTokenizer(lang),
  })
  engine.addAll(records)
  return { v: 1, lang, options: { fields, storeFields }, index: JSON.stringify(engine) }
}

const EN = [
  {
    id: '/guide.html',
    title: 'Guide',
    titles: [],
    text: 'Install the docs toolchain first.',
    kind: 'page',
  },
  {
    id: '/config.html',
    title: 'Config',
    titles: ['Reference'],
    text: 'Every docs site has one config file.',
    kind: 'page',
  },
]
const ZH = [
  { id: '/zh/guide.html', title: '指南', titles: [], text: '安装 docs 工具链。', kind: 'page' },
]

const files = new Map<string, object>([
  [
    '/any-search/root.titles.json',
    artifact('en-US', EN, ['title', 'titles'], ['title', 'titles', 'kind']),
  ],
  [
    '/any-search/root.content.json',
    artifact('en-US', EN, ['title', 'titles', 'text'], ['title', 'titles', 'text', 'kind']),
  ],
  [
    '/any-search/zh.titles.json',
    artifact('zh-CN', ZH, ['title', 'titles'], ['title', 'titles', 'kind']),
  ],
  [
    '/any-search/zh.content.json',
    artifact('zh-CN', ZH, ['title', 'titles', 'text'], ['title', 'titles', 'text', 'kind']),
  ],
])

const held = new Set<string>()
const release = new Map<string, () => void>()
let closed = false
const posted: any[] = []
const listeners: ((event: { data: unknown }) => void)[] = []

;(globalThis as any).self = {
  addEventListener: (_type: string, fn: (event: { data: unknown }) => void) => listeners.push(fn),
  postMessage: (message: unknown) => posted.push(message),
  close: () => (closed = true),
}
;(globalThis as any).fetch = async (url: string) => {
  const body = files.get(url)
  if (!body) return { ok: false, status: 404, statusText: 'Not Found' }
  if (held.has(url)) await new Promise<void>((resolve) => release.set(url, resolve))
  return { ok: true, json: async () => body }
}

await import(`${REPO}/src/adapters/minisearch/worker.ts`)

const send = (message: unknown) => listeners.forEach((fn) => fn({ data: message }))
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}
const drain = () => posted.splice(0, posted.length)
const entry = (locale: string) => ({
  lang: locale === 'zh' ? 'zh-CN' : 'en-US',
  titles: `any-search/${locale}.titles.json`,
  content: `any-search/${locale}.content.json`,
  sections: 2,
})

let failed = 0
function check(label: string, ok: unknown, detail?: unknown) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (detail !== undefined && (!ok || process.env.VERBOSE))
    console.log(`      ${JSON.stringify(detail)}`)
}

console.log('\n— init sequencing —')
held.add('/any-search/root.content.json')
send({ type: 'init', base: '/', locale: 'root', entry: entry('root') })
await flush()
check(
  'titles tier is announced before content is fetched',
  JSON.stringify(drain()) === JSON.stringify([{ type: 'tier', tier: 'titles' }]),
)

send({ type: 'search', id: 1, query: 'guide' })
await flush()
const early = posted[0] as any
check(
  'search works on the titles tier alone',
  early?.type === 'results' && early.id === 1 && early.response.results.length === 1,
  early?.response?.results?.[0],
)
check('no excerpt before the content tier lands', early?.response.results[0].excerpt === undefined)
drain()

release.get('/any-search/root.content.json')!()
held.delete('/any-search/root.content.json')
await flush()
check(
  'content tier is announced when it lands',
  JSON.stringify(drain()) === JSON.stringify([{ type: 'tier', tier: 'content' }]),
)

send({ type: 'search', id: 2, query: 'docs', limit: 1 })
await flush()
const upgraded = posted[0] as any
check(
  'content tier answers body-text queries',
  upgraded?.response.total.count === 2 && upgraded.response.results.length === 1,
  upgraded?.response.total,
)
check(
  'excerpt appears once content is loaded',
  upgraded?.response.results[0].excerpt !== undefined,
  upgraded?.response.results[0].excerpt,
)
check('response ids correlate', upgraded?.id === 2)
drain()

console.log('\n— re-init (locale switch) —')
send({ type: 'init', base: '/', locale: 'zh', entry: entry('zh') })
await flush()
check(
  'both tiers re-announce for the new locale',
  JSON.stringify(drain()) ===
    JSON.stringify([
      { type: 'tier', tier: 'titles' },
      { type: 'tier', tier: 'content' },
    ]),
)
send({ type: 'search', id: 3, query: '指南' })
await flush()
const zh = posted[0] as any
check(
  'state was replaced by the new locale',
  zh?.response.results.length === 1 && zh.response.results[0].url === '/zh/guide.html',
  zh?.response.results[0]?.url,
)
drain()
send({ type: 'search', id: 4, query: 'guide' })
await flush()
check('the previous locale is gone', (posted[0] as any)?.response.results.length === 0)
drain()

console.log('\n— superseded init —')
held.add('/any-search/root.titles.json')
send({ type: 'init', base: '/', locale: 'root', entry: entry('root') })
await flush()
send({ type: 'init', base: '/', locale: 'zh', entry: entry('zh') })
await flush()
const afterSecond = drain()
release.get('/any-search/root.titles.json')!()
held.delete('/any-search/root.titles.json')
await flush()
check(
  'the superseded init posts nothing when it finally lands',
  JSON.stringify(drain()) === '[]',
  afterSecond,
)
send({ type: 'search', id: 5, query: '指南' })
await flush()
check(
  'the winning locale still owns the state',
  (posted[0] as any)?.response.results[0]?.url === '/zh/guide.html',
)
drain()

console.log('\n— failures —')
send({
  type: 'init',
  base: '/',
  locale: 'missing',
  entry: {
    lang: 'en-US',
    titles: 'any-search/nope.json',
    content: 'any-search/nope.json',
    sections: 0,
  },
})
await flush()
const failure = posted[0] as any
check(
  'a failed artifact fetch reports an error instead of hanging',
  failure?.type === 'error' && failure.id === undefined,
  failure,
)
check(
  'the error names the status and url',
  /404 Not Found for \/any-search\/nope\.json/.test(failure?.message ?? ''),
  failure?.message,
)
drain()

console.log('\n— dispose —')
send({ type: 'dispose' })
check('dispose closes the worker', closed === true)

console.log(`\n${failed ? `${failed} FAILED` : 'all checks passed'}`)
process.exit(failed ? 1 : 0)
