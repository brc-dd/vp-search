import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Rolldown, UserConfig } from 'tsdown'

/** A quoted relative specifier with the source `.ts` extension. */
const RELATIVE_TS_RE = /(['"])(\.[^'"]*?)\.ts\1/g

/**
 * Files that bypass rolldown's module graph keep their authored specifiers:
 * raw `.vue` assets (and their vue-tsc declarations) emitted by
 * `vueSfcPlugin`, hand-written ambient `.d.ts` files, and `new URL(...,
 * import.meta.url)` references inside chunks. This plugin ships the ambient
 * `.d.ts` files and points all of those specifiers at the built `.js` names.
 */
function sourceAssets(dir: string): Rolldown.Plugin {
  return {
    name: 'vp-search:source-assets',
    buildStart() {
      const src = join(dir, 'src')
      for (const entry of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
        if (!entry.endsWith('.d.ts')) continue
        const file = join(src, entry)
        this.addWatchFile(file)
        this.emitFile({ type: 'asset', fileName: entry, source: readFileSync(file, 'utf8') })
      }
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') {
          file.code = file.code.replace(/new URL\((['"])(\.[^'"]*?)\.ts\1/g, 'new URL($1$2.js$1')
        } else if (
          typeof file.source === 'string' &&
          (file.fileName.endsWith('.vue') || file.fileName.endsWith('.ts'))
        ) {
          file.source = file.source.replace(RELATIVE_TS_RE, '$1$2.js$1')
        }
      }
    },
  }
}

export function baseConfig(dir: string, plugins: Rolldown.Plugin[] = []): UserConfig {
  return {
    entry: ['src/**/*.ts', '!src/**/*.d.ts'],
    platform: 'neutral',
    unbundle: true,
    dts: true,
    unused: true,
    publint: true,
    attw: { profile: 'esm-only', level: 'error' },
    deps: { neverBundle: [/^virtual:/, /^node:/] },
    plugins: [...plugins, sourceAssets(dir)],
  }
}
