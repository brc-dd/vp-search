# vp-search

Pluggable search for VitePress: one accessible, theme-native search UI, with backends as thin adapters over a shared result format.

> Pre-release — not yet on npm. The Algolia and MiniSearch providers work end to end: built, typed, and covered by ~700 tests including real-browser e2e and a nightly live contract against the public DocSearch index. Design decisions live in [DESIGN.md](DESIGN.md), the worklist in [TODO.md](TODO.md).

## Why

VitePress ships two search UIs (local/MiniSearch and Algolia DocSearch) and the ecosystem has many more — each with its own widget, styling, accessibility story, and sometimes its own framework (DocSearch pulls in Preact). This project inverts that: the UI is ours — one component, aligned with the default theme, accessible by design — and backends transform their native output into a shared result format.

- **One UI, any backend.** Swapping providers is a config change, not a UI change.
- **Shared data format.** A normalized result shape that keeps what docs search needs — breadcrumbs, deep links, highlighted excerpts — as text segments, so marks render without HTML injection.
- **Accessible.** Combobox semantics, full keyboard support, live-region announcements, focus management — implemented once, tested once.
- **ToS-friendly.** Adapters declare their attribution and the UI renders it, as the free DocSearch program's terms require.
- **Light.** No Preact, no bundled backend SDKs. Providers are separate packages, so installing one never installs another's dependencies; the Algolia adapter speaks the REST API directly over `fetch`.

Non-goals: AI answer/chat surfaces (this is search only), crawling/indexing services, replacing VitePress's built-in providers upstream, ranking logic of our own.

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

Providers are objects, not strings: `minisearch()` from `@vp-search/minisearch`, `algolia({ appId, apiKey, indexName })` from `@vp-search/algolia`, or any third-party package implementing the `ProviderDefinition` contract from `@vp-search/core/node`. No package is needed for a hand-written adapter either: `search({ name: 'custom', clientModule: './my-adapter.ts' })`, where the file default-exports an adapter factory.

## What works today

- **The search dialog**: wrapping keyboard navigation (including `Ctrl+N/P` on mac), IME-safe Enter, a result-count live region, focus restoration on close, back-button close that leaves history clean, scroll lock, per-locale translations, and query persistence across reopens.
- **`@vp-search/minisearch`**: per-locale indexes built from the rendered site — dynamic routes, Vite transforms, and frontmatter interpolation included — split into an instant titles tier and a lazily fetched content tier, queried in a Web Worker with `Intl.Segmenter`-based CJK segmentation; dev mode indexes on demand and re-indexes on edit.
- **`@vp-search/algolia`**: DocSearch-compatible over plain `fetch` — sentinel-tag highlighting, entity and zero-width-space cleanup, locale facets — with its schema assumptions contract-tested nightly against the live vitepress index.
- **Third-party providers**: the `ProviderDefinition`/`ProviderApi` seam our own providers use is the public one, down to the zero-package `clientModule` escape hatch.
- **Builds**: tsdown per package, Vue components shipped as raw SFC source, every build validated by publint and arethetypeswrong.

## Layout

```
packages/
  core/        # @vp-search/core — result format + adapter contract, highlight
               # helpers, translations, the search UI, the search() vite plugin
  algolia/     # @vp-search/algolia — DocSearch-shaped Algolia provider (dep-free)
  minisearch/  # @vp-search/minisearch — build-time local index + worker search
               # (owns the minisearch + linkedom dependencies)
examples/
  docs/        # the official VitePress docs, search replaced by this plugin
test/          # cross-package fixtures, dist-integrity suite, e2e fixture site
DESIGN.md      # what is decided and why, what is rejected, what is open
```

Workspace development consumes raw TS/SFC source; `publishConfig.exports` flips packages to their `dist` builds at pack time.

## Development

```sh
pnpm install
pnpm build           # tsdown builds + publint + attw for every package
pnpm typecheck       # per-environment tsconfig projects, then the test projects
pnpm test:unit       # hermetic lanes (engine, client, worker, node)
pnpm test:integrity  # validates the built dist (run pnpm build first)
pnpm test:e2e        # real-browser e2e over the fixture site (dev server mode)
pnpm test:e2e:build  # the same e2e suite against built output
pnpm test:live       # Algolia schema-drift contract against the live index
pnpm docs:dev        # the official docs example with vp-search as navbar search
```
