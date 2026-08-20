import { search } from '@vp-search/core/node'
import { minisearch } from '@vp-search/minisearch'
import { defineConfig } from 'vitepress'

/**
 * A second, deliberately tiny fixture site, served by the HMR test's own dev
 * server. Editing a page of the shared site instead would reach every other
 * test file at once: invalidating the manifest reloads the navbar component on
 * every connected client, and a dialog that vanishes mid-assertion fails
 * whatever file was using it. This root sits outside the shared site's
 * watcher, so nothing here is visible to it.
 */
export default defineConfig({
  title: 'VP Search HMR',
  description: 'Fixture site for the vp-search hot-update test.',

  vite: {
    plugins: [search(minisearch())],
    logLevel: 'warn',
  },
})
