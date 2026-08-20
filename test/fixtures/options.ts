import type { SearchOptions } from '../../packages/core/src/translations.ts'

/**
 * Stand-in for `virtual:vp-search/options`, which core's node plugin emits as
 * `JSON.stringify({ translations, locales })` — so only JSON-able values here.
 */

function defaults(): SearchOptions {
  return {
    locales: {
      zh: {
        translations: {
          button: { buttonText: '搜索' },
          modal: { noResultsText: '无法找到相关结果' },
        },
      },
    },
  }
}

let options: SearchOptions = defaults()

// `export { x as default }`, not `export default x` — only the former keeps the
// binding live, so `__setOptions` reaches modules that already imported it
export { options as default }

export function __setOptions(next: SearchOptions): void {
  options = next
}

export function __reset(): void {
  options = defaults()
}
