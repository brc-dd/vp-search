import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const ci = !!process.env['CI']

export default defineConfig({
  test: {
    clearMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    // reaches workers only, and only under the `forks` pool — CI job env pins these too
    env: { TZ: 'UTC', LANG: 'en_US.UTF-8' },
    snapshotSerializers: [at('./test/serializers/marked-text.ts')],
    // auto-detection dies the moment `reporters` is set
    reporters: process.env['GITHUB_ACTIONS'] ? ['default', 'github-actions'] : ['default'],
    // root-only in v5 (a NonProjectOption), so the e2e lane's teardown budget lives here
    teardownTimeout: 30_000,
    tags: [
      {
        name: 'flaky',
        description: 'quarantine tag: known-unstable test, retried in CI only',
        retry: ci ? 2 : 0,
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'shared',
          environment: 'node',
          include: ['packages/*/test/shared/**/*.test.ts'],
          isolate: false,
          retry: 0,
        },
      },
      {
        extends: true,
        plugins: [vue()],
        resolve: {
          // first match wins and a bare key also matches `<key>/…`, so the deep
          // path must precede `vitepress`
          alias: {
            'vitepress/dist/client/theme-default/components/VPNavBarSearchButton.vue': at(
              './test/fixtures/VPNavBarSearchButton.vue',
            ),
            vitepress: at('./test/fixtures/vitepress.ts'),
            'virtual:vp-search/adapter': at('./test/fixtures/adapter.ts'),
            'virtual:vp-search/options': at('./test/fixtures/options.ts'),
          },
        },
        test: {
          name: 'client',
          environment: 'happy-dom',
          include: ['packages/*/test/client/**/*.test.ts'],
          // unasserted console.warn/error fails the test; expectConsole() claims expected output
          setupFiles: ['test/setup/console.ts'],
        },
      },
      {
        extends: true,
        resolve: {
          alias: {
            'virtual:vp-search/minisearch/manifest': at('./test/fixtures/manifest.ts'),
          },
        },
        test: {
          name: 'worker',
          environment: 'node',
          setupFiles: ['@vitest/web-worker'],
          include: ['packages/minisearch/test/worker/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/node/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integrity',
          environment: 'node',
          include: ['test/integrity/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['test/e2e/tests/**/*.test.ts'],
          globalSetup: ['test/e2e/setup/global.ts'],
          setupFiles: ['test/e2e/setup/per-file.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          retry: ci
            ? { count: 2, delay: 250, condition: /timeout|Target (page|closed)|net::|crashed/i }
            : 0,
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          environment: 'node',
          include: ['packages/algolia/test/live/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
})
