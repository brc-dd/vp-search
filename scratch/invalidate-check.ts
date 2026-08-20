import { useSearch } from '../src/client/useSearch.ts'
import type { SearchAdapter } from '../src/adapter.ts'

let phase = 'titles'
let notify: (() => void) | undefined

const adapter: SearchAdapter = {
  name: 'fake',
  search: (query) => ({
    results: [{ url: '/a', title: [{ text: `${query}:${phase}` }] }],
    total: { count: phase === 'titles' ? 3 : 12, exact: true },
  }),
  onInvalidate(listener) {
    notify = listener
    return () => (notify = undefined)
  },
}

const { query, results, total } = useSearch({ adapter, debounce: 1 })
query.value = 'github'
await new Promise((r) => setTimeout(r, 30))
console.log('after titles-phase search:', total.value?.count, results.value[0]?.title[0]?.text)

phase = 'content'
notify?.()
await new Promise((r) => setTimeout(r, 30))
console.log('after invalidate:        ', total.value?.count, results.value[0]?.title[0]?.text)

if (total.value?.count !== 12) throw new Error('invalidation did not re-run the query')
console.log('PASS: invalidation re-runs the active query')
