import type { ProviderDefinition } from '@vp-search/core/node'
import type { AlgoliaAdapterOptions } from './adapter.ts'

export { algoliaAdapter, type AlgoliaAdapterOptions, type DocSearchHit } from './adapter.ts'

/**
 * DocSearch-shaped Algolia search as a vp-search provider. Remote-only: no
 * node-side hooks, just the adapter and its options handed to the client.
 */
export function algolia(options: AlgoliaAdapterOptions): ProviderDefinition {
  return {
    name: 'algolia',
    clientModule: '@vp-search/algolia/adapter',
    clientOptions: options,
  }
}
