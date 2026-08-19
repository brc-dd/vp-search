# vitepress-any-search

Backend-agnostic search for VitePress: one accessible, theme-native search UI, with the backend swappable behind a small adapter interface.

> Status: working Algolia wiring. The shared format, adapter contract, an accessible `<dialog>`-based UI, the vite plugin (alias + virtual modules), and an example running the official VitePress docs are in place. Other adapters and upstreaming are future phases; see [DESIGN.md](DESIGN.md).

## Why

VitePress ships two search UIs (local/MiniSearch and Algolia DocSearch) and the ecosystem has many more (Pagefind, Orama, Meilisearch, Typesense, FlexSearch, …). Each brings its own widget, its own styling, its own accessibility story, and sometimes its own framework (DocSearch pulls in Preact).

This project inverts that: the UI is ours — one component, aligned with the default theme, accessible by design — and backends are thin adapters that transform their native output into a shared result format.

Goals:

- **One UI, any backend.** Swapping Algolia for Pagefind (or a paid Algolia index that doesn't fit DocSearch's mold) is a config change, not a UI change.
- **Shared data format.** A normalized result shape that every backend's output transforms into cheaply, without losing what docs search needs: breadcrumb hierarchy, deep links, highlighted excerpts.
- **Accessible.** Combobox semantics, full keyboard support, screen-reader announcements — implemented once, tested once.
- **ToS-friendly.** A dedicated `powered-by` slot/area so each backend's attribution/logo renders where their terms require it.
- **Light.** No Preact, no bundled backend SDKs. Backend clients are optional peer dependencies loaded lazily by their adapter; the Algolia adapter speaks the REST API directly via `fetch`.

Non-goals: AI answer/chat surfaces (DocSearch's askAi side panel and similar) — this is search only, the format models plain search results; crawling/indexing services; replacing VitePress's built-in providers upstream; ranking logic of our own.

## Layout

```
src/
  types.ts          # the shared data format (the core of this project)
  adapter.ts        # SearchAdapter contract + defineSearchAdapter helper
  highlight.ts      # backend highlight styles -> segments, entity decoding
  translations.ts   # SearchTranslations + defaults + resolver
  adapters/         # one module per backend (subpath exports)
  client/           # VPNavBarSearch (aliased entry) + VPSearchBox dialog
  node/             # anySearch() vite plugin: alias hijack + virtual modules
examples/
  algolia-live.ts   # CLI end-to-end check against the real vitepress index
  docs/             # the official VitePress docs, search replaced by this plugin
DESIGN.md           # data format rationale + per-backend mapping tables
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm example:algolia   # live query against the vitepress DocSearch index, printed normalized
pnpm docs:dev          # official docs example with vitepress-any-search as the navbar search
```
