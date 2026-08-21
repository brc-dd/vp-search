/**
 * DESIGN §3: importing an adapter module and calling its factory must never touch `document`,
 * `window`, or `Worker` — only `load()`/`search()` may reach for browser APIs. Node has no DOM by
 * default, so the guard below asserts that first; otherwise a `document`-touching adapter would
 * pass by accident under a jsdom-flavored project.
 */

import { describe, expect, test, vi } from 'vitest'
import type { SearchAdapter } from '../../src/index.ts'

// The node project aliases no virtual modules, so this mock is what makes minisearch's lazy
// `import()` inside `load()` reachable here — and the seam that would catch that specifier moving
// to module scope, which it must not.
vi.mock('virtual:vp-search/minisearch/manifest', () => ({ default: null }))

/**
 * Cross-package by relative path — neither provider is a devDep of core, and this is exactly what
 * each published `./adapter` entry does. The minisearch import goes through this variable so tsc
 * stops at the boundary instead of following its `virtual:` specifier, which only minisearch's own
 * tsconfig `paths` maps; Vite still resolves it fine at runtime.
 */
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

    // `load()` gets as far as the virtual module (mocked to the null stub core serves for an
    // inactive provider) and gives up there — no `new Worker`.
    await expect(adapter.load?.({})).rejects.toThrow(/running another provider/)
    expect(globalThis.Worker).toBeUndefined()
  })

  test('neither module defines a browser global as a side effect', async () => {
    await Promise.all([ADAPTERS.algolia(), ADAPTERS.minisearch()])

    expect(globalThis.document).toBeUndefined()
    expect(globalThis.window).toBeUndefined()
  })
})
