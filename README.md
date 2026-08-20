# vp-search

Backend-agnostic search for VitePress: one accessible, theme-native search UI, with the backend swappable behind a small adapter interface.

> Status: working Algolia + MiniSearch providers, browser-verified in `examples/docs`. The shared format, adapter contract, an accessible `<dialog>`-based UI, the core vite plugin (alias + virtual modules + provider plumbing), and separate provider packages are in place. More providers, real builds, and publishing are future phases; see [DESIGN.md](DESIGN.md) and [TODO.md](TODO.md).

## Why

VitePress ships two search UIs (local/MiniSearch and Algolia DocSearch) and the ecosystem has many more (Pagefind, Orama, Meilisearch, Typesense, FlexSearch, …). Each brings its own widget, its own styling, its own accessibility story, and sometimes its own framework (DocSearch pulls in Preact).

This project inverts that: the UI is ours — one component, aligned with the default theme, accessible by design — and backends are thin adapters that transform their native output into a shared result format.

Goals:

- **One UI, any backend.** Swapping Algolia for MiniSearch (or a paid Algolia index that doesn't fit DocSearch's mold) is a config change, not a UI change.
- **Shared data format.** A normalized result shape that every backend's output transforms into cheaply, without losing what docs search needs: breadcrumb hierarchy, deep links, highlighted excerpts.
- **Accessible.** Combobox semantics, full keyboard support, screen-reader announcements — implemented once, tested once.
- **ToS-friendly.** A dedicated `powered-by` slot/area so each backend's attribution/logo renders where their terms require it.
- **Light.** No Preact, no bundled backend SDKs. Providers are separate packages, so installing one never installs another's dependencies; the Algolia adapter speaks the REST API directly via `fetch`.

Non-goals: AI answer/chat surfaces (DocSearch's askAi side panel and similar) — this is search only, the format models plain search results; crawling/indexing services; replacing VitePress's built-in providers upstream; ranking logic of our own.

## Usage

```ts
// .vitepress/config.ts
import { search } from '@vp-search/core/node'
import { minisearch } from '@vp-search/minisearch'

export default defineConfig({
  vite: {
    plugins: [search(minisearch())],
  },
})
```

Providers are objects, not strings: `minisearch()` from `@vp-search/minisearch`, `algolia({ appId, apiKey, indexName })` from `@vp-search/algolia`, or any third-party package implementing the `ProviderDefinition` contract from `@vp-search/core/node`. A local module exporting a constructed adapter works too: `search({ adapterFile: './my-adapter.ts' })`.

## Layout

pnpm workspace; every package ships raw TS/SFC source for now (builds are a future phase).

```
packages/
  core/       # @vp-search/core — shared format + adapter contract, highlight
              # helpers, translations, the search UI, the search() vite plugin
  algolia/    # @vp-search/algolia — DocSearch-shaped Algolia provider (dep-free)
  minisearch/ # @vp-search/minisearch — build-time local index + worker search
              # (owns the minisearch + linkedom dependencies)
examples/
  docs/             # the official VitePress docs, search replaced by this plugin
DESIGN.md           # data format rationale + per-backend mapping tables
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm docs:dev   # official docs example with vp-search as the navbar search
```
