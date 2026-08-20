/**
 * DESIGN §3, "SSR-safe by construction": VitePress renders every page in Node
 * before it reaches a browser, so importing an adapter module — and calling
 * its factory — must not touch `document`, `window`, or `Worker`. The
 * guarantee covers module scope and construction only: `load()`/`search()`
 * legitimately reach for browser APIs, and the one `load()` here is the case
 * that fails before it gets that far.
 *
 * This lane is bare Node, so the absence of a DOM is asserted first — without
 * that, an adapter that used `document` would pass by accident under a jsdom
 * default.
 */

import { describe, expect, test, vi } from 'vitest'
import type { SearchAdapter } from '../../src/index.ts'

// The node project aliases no virtual modules. The minisearch adapter reaches
// its manifest through a lazy `import()` inside `load()`, so this factory is
// what makes that path reachable at all here — and it is the seam that would
// catch the specifier moving to module scope, where it must never be.
vi.mock('virtual:vp-search/minisearch/manifest', () => ({ default: null }))

/** Cross-package by relative path: neither provider is a devDep of core, and
 * the subject is exactly what each published `./adapter` entry does. The
 * minisearch one goes through a variable so tsc stops at the boundary — its
 * `virtual:` specifier is mapped by minisearch's own tsconfig `paths`, and
 * typechecking another package's src from here would need that mapping
 * duplicated. Vite still resolves it at runtime, which is the point. */
const importAtRuntime = (specifier: string): Promise<Record<string, unknown>> =>
  import(specifier) as Promise<Record<string, unknown>>

interface AdapterModule {
  default: (options?: never) => SearchAdapter
}

const ADAPTERS = {
  algolia: () => import('../../../algolia/src/adapter.ts'),
  minisearch: () =>
    importAtRuntime('../../../minisearch/src/adapter.ts') as unknown as Promise<AdapterModule>,
}

describe('the node lane really has no browser', () => {
  test.each(['document', 'window', 'Worker'])('%s is undefined', (name) => {
    expect(globalThis[name as keyof typeof globalThis]).toBeUndefined()
  })
})

describe('adapter modules import and construct under bare Node', () => {
  test('algolia', async () => {
    const module = await ADAPTERS.algolia()
    const adapter = module.default({ appId: 'APP', apiKey: 'KEY', indexName: 'docs' })

    expect(adapter).toHaveProperty('search', expect.any(Function))
    expect(adapter.name).toBe('algolia')
  })

  test('minisearch', async () => {
    const module = await ADAPTERS.minisearch()
    const adapter = module.default()

    expect(adapter).toHaveProperty('search', expect.any(Function))
    expect(adapter.name).toBe('minisearch')
  })

  test('constructing the minisearch adapter spawns no worker', async () => {
    const module = await ADAPTERS.minisearch()
    module.default()

    expect(globalThis.Worker).toBeUndefined()
  })

  test('its manifest import is lazy, and a null manifest fails before any worker', async () => {
    const module = await ADAPTERS.minisearch()
    const adapter = module.default()

    // `load()` gets as far as the virtual module (mocked to the null stub core
    // serves for an inactive provider) and gives up there — no `new Worker`.
    await expect(adapter.load?.({})).rejects.toThrow(/running another provider/)
    expect(globalThis.Worker).toBeUndefined()
  })

  test('neither module defines a browser global as a side effect', async () => {
    await Promise.all([ADAPTERS.algolia(), ADAPTERS.minisearch()])

    expect(globalThis.document).toBeUndefined()
    expect(globalThis.window).toBeUndefined()
  })
})
