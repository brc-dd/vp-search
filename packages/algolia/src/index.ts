import type { ProviderDefinition } from '@vp-search/core/node'
import type { AlgoliaAdapterOptions } from './adapter.ts'

export { algoliaAdapter, type AlgoliaAdapterOptions, type DocSearchHit } from './adapter.ts'

/** DocSearch-shaped Algolia search as a vp-search provider — remote-only, no node-side hooks. */
export function algolia(options: AlgoliaAdapterOptions): ProviderDefinition {
  return {
    name: 'algolia',
    clientModule: '@vp-search/algolia/adapter',
    clientOptions: options,
  }
}
