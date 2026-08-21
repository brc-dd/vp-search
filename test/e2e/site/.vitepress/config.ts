import { search } from '@vp-search/core/node'
import { minisearch } from '@vp-search/minisearch'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitepress'

/**
 * Stands in for any plugin that rewrites markdown before VitePress renders it (#4979). `enforce:
 * 'pre'` puts it ahead of the markdown-to-Vue transform, so the rendered page carries
 * `xformtoken4979` while the file on disk — all the dev indexer ever reads — still carries
 * `rawslot4979x`.
 */
function injectToken(): Plugin {
  return {
    name: 'e2e-inject-token',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0]?.endsWith('/guide/transformed.md')) return
      return code.replace('rawslot4979x', 'xformtoken4979')
    },
  }
}

/**
 * Fixture site for the e2e lane — tiny and self-contained, not `examples/docs` (DESIGN §13: that's
 * vendored upstream content and would churn on every sync).
 *
 * Page bodies carry unique grep-able tokens (`quokka*`, `zhonlytoken`, …) so every assertion can
 * name exactly one record. `cleanUrls` stays off: `.html` ids resolve identically under `vitepress
 * dev` and the preview server, which keeps the dev/build double pass comparing like with like.
 */
export default defineConfig({
  title: 'VP Search E2E',
  description: 'Fixture site for the vp-search end-to-end suite.',

  // `parts/` holds `@include` partials and snippet sources, not pages: without this they would be
  // routes of their own and their tokens would be findable at two URLs.
  srcExclude: ['**/parts/*.md'],

  themeConfig: {
    nav: [{ text: 'Guide', link: '/guide/alpha' }],
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        sidebar: [
          {
            text: 'Guide',
            items: [
              { text: 'Alpha', link: '/guide/alpha' },
              { text: 'Beta', link: '/guide/beta' },
            ],
          },
          {
            text: 'Reference',
            items: [
              { text: 'Bare', link: '/bare' },
              { text: 'Hidden', link: '/hidden' },
            ],
          },
        ],
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-Hans',
      themeConfig: {
        nav: [{ text: '指南', link: '/zh/guide' }],
        sidebar: [
          {
            text: '指南',
            items: [{ text: '中文指南', link: '/zh/guide' }],
          },
        ],
      },
    },
  },

  vite: {
    plugins: [injectToken(), search(minisearch())],
    // Vite's info banner is noise inside a vitest reporter.
    logLevel: 'warn',
  },
})
