// End-to-end check of the shared format against a real backend: queries the
// public VitePress DocSearch index through the Algolia adapter and prints
// normalized results. Marks render bold+yellow.
//
//   pnpm example:algolia [query]

import { algoliaAdapter, textOf, type MarkedText } from '../src/index.ts'

const adapter = algoliaAdapter({
  appId: '8J64VVRP8K',
  apiKey: '52f578a92b88ad6abde815aae2b0ad7c',
  indexName: 'vitepress',
})

const query = process.argv[2] ?? 'custom containers'
const response = await adapter.search(query, { lang: 'en-US', limit: 5 })

const render = (text: MarkedText) =>
  text.map((seg) => (seg.mark ? `\x1b[1;33m${seg.text}\x1b[0m` : seg.text)).join('')

console.log(
  `${response.total?.count}${response.total?.exact ? '' : '+'} results for "${query}" (${response.elapsedMs}ms)\n`,
)
for (const result of response.results) {
  const crumbs = [...(result.titles ?? []).map(render), render(result.title)]
  console.log(`• ${crumbs.join(' › ')}  (${result.kind})`)
  if (result.excerpt) console.log(`  ${render(result.excerpt)}`)
  console.log(`  ${result.url}`)
  console.log(`  group: ${result.group} · plain title: ${textOf(result.title)}\n`)
}
