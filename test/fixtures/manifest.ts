import type { IndexData, LocaleEntry } from '../../packages/minisearch/src/types.ts'

/**
 * Stand-in for `virtual:vp-search/minisearch/manifest`. Defaults to the dev
 * shape (`locales` inlined, `manifest` null), so the adapter needs no fetch;
 * `__setBuildShape()` switches to the build shape it does fetch.
 */

const ROOT: LocaleEntry = {
  lang: 'en',
  titles: 'vp-search/titles.root.json',
  content: 'vp-search/content.root.json',
  sections: 3,
}

function defaults(): IndexData {
  return { base: '/', locales: { root: ROOT }, manifest: null }
}

let data: IndexData | null = defaults()

export { data as default }

export function __setData(next: IndexData | null): void {
  data = next
}

export function __setBuildShape(manifest = 'vp-search/manifest.json'): void {
  data = { base: '/', locales: null, manifest }
}

export function __reset(): void {
  data = defaults()
}
