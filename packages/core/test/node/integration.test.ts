import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { expect, test } from 'vitest'
import { search } from '../../src/node/index.ts'
import { fakeSiteConfig, tempDir } from './helpers.ts'

/**
 * One pass through a real vite server. Hook-level tests can't catch a `\0`
 * mismatch between `resolveId` and `load`, an id vite refuses to route to us,
 * or a `clientModule` path that resolves on paper but not through the
 * resolver — this does.
 */
test('a real vite server routes and executes every vp-search virtual module', async () => {
  const root = await tempDir()
  // The `.vitepress` dir is what makes this a VitePress project root.
  await mkdir(join(root, '.vitepress'), { recursive: true })
  await writeFile(
    join(root, 'adapter.ts'),
    'export default (options) => ({ name: "fixture", options })\n',
  )

  const plugin = search(
    {
      name: 'fixture',
      clientModule: './adapter.ts',
      clientOptions: { tiers: 2 },
      node: {
        setup(_siteConfig, api) {
          api.addVirtualModule('manifest', () => 'export default { ready: true }\n')
        },
      },
    },
    { translations: { button: { buttonText: 'Find' } } },
  )

  let server: ViteDevServer | undefined
  try {
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true },
      plugins: [plugin],
      // How VitePress hands its resolved config to plugins.
      vitepress: fakeSiteConfig({ root }),
    })

    const options = await server.ssrLoadModule('virtual:vp-search/options')
    expect(options['default']).toEqual({ translations: { button: { buttonText: 'Find' } } })

    const providerOptions = await server.ssrLoadModule('virtual:vp-search/provider-options')
    expect(providerOptions['default']).toEqual({ tiers: 2 })

    const manifest = await server.ssrLoadModule('virtual:vp-search/fixture/manifest')
    expect(manifest['default']).toEqual({ ready: true })

    // Never registered, still importable — the promise DESIGN §8b makes.
    const stub = await server.ssrLoadModule('virtual:vp-search/fixture/not-registered')
    expect(stub['default']).toBeNull()

    // The whole seam end to end: relative clientModule resolved against the
    // project root, imported, and instantiated with provider-options.
    const adapter = await server.ssrLoadModule('virtual:vp-search/adapter')
    expect(adapter['default']).toEqual({ name: 'fixture', options: { tiers: 2 } })
  } finally {
    await server?.close()
  }
}, 30_000)
