# Design: the shared search format

One data format, one adapter contract, and one VitePress UI that any search backend — hosted API, build-time local index, or post-build static — can sit behind. This document records what is decided and why, what is rejected and why, and what is still open; long-form rationale lives in git history. Backend claims come from source reading and live-verified response schemas.

Scope guard: **search only**. AI answer surfaces (DocSearch askAi, side panels, conversational hits) are out of scope; the format deliberately cannot represent them.

## 1. What is actually universal

Across nine backends (Algolia, Meilisearch, Typesense, Pagefind, Orama, MiniSearch, Fuse.js, FlexSearch, Lunr), only four things exist everywhere: an id-ish handle, an ordered result list, the source fields, and _some_ notion of relevance ordering. Everything else varies structurally:

- **Highlighting** has four incompatible representations — inline tags, character/byte positions, matched-term lists, or nothing at all — mapped per backend by §2's helper table.
- **Hierarchy/breadcrumbs** are native nowhere except Pagefind's flat `sub_results`; everywhere else they are scraper/indexer _convention_ (DocSearch `lvl0–6`, VitePress/Nuxt `titles[]`).
- **Totals** are exact (most), estimated (Meilisearch `estimatedTotalHits`), or unknowable (FlexSearch).
- **Scores** are incomparable: Fuse inverts (0 = best), FlexSearch has none, Typesense's `text_match` overflows `Number.MAX_SAFE_INTEGER`, Algolia ranks lexicographically rather than by scalar.

So the format is a **required core every backend can fill**, plus optional fields that degrade gracefully, plus `raw` as the escape hatch (the pattern every serious adapter layer uses — Typesense's `_rawTypesenseHit`, InstantSearch's `results`).

## 2. The result shape ([types.ts](packages/core/src/types.ts))

```ts
interface SearchResult {
  id?: string // stable key; falls back to url
  url: string // href-ready, anchor included
  title: MarkedText // own heading / page title
  titles?: MarkedText[] // ancestor breadcrumb, root-first, self excluded
  excerpt?: MarkedText
  group?: string // top-level grouping label (DocSearch lvl0)
  kind?: 'page' | 'heading' | 'content'
  score?: number // backend-relative; never displayed
  raw?: unknown
}
```

### `title` + `titles[]`, not `lvl0..lvl6`

VitePress local search, Nuxt Content, and easyops' Docusaurus plugin converged independently on this vocabulary — a de-facto interchange contract. DocSearch's seven fixed slots are its most-criticized wart: inconsistent nullability, the `hierarchy_camel`/`hierarchy_radio` quadruplication, a `type` field conflating record kind with depth. The array carries the same information; `kind` carries the rest.

### `MarkedText` segments, not HTML strings and not positions

```ts
type MarkedText = { text: string; mark?: boolean }[]
```

- **Not HTML strings** — tag-wrapped formats accumulate escaping scars (InstantSearch's escape-then-reinject dance, `dangerouslySetInnerHTML` in DocSearch), and InstantSearch deprecated its string-returning helpers for `{ value, isHighlighted }` segment arrays — this shape, arrived at the hard way. Segments make XSS impossible by construction (the UI renders text nodes), keep mark styling in the UI, and give screen-reader/plain output for free (`textOf`). Fumadocs went the other way (markdown strings with `<mark>` in the MDAST, so rows render inline code) at the price of a client-side markdown renderer and a reopened escaping surface — known tradeoff, same verdict.
- **Not positions** — three backends (Algolia, Typesense, FlexSearch) can't produce them without parsing tags back out, and the units are a minefield: Meilisearch reports UTF-8 **byte** offsets, Fuse and @orama/highlight **inclusive** ends, Lunr `[start, length]`, Pagefind **word indices**. Positions exist only as adapter-internal input, normalized by [highlight.ts](packages/core/src/highlight.ts) at the boundary.

Everything displayable (`title`, `titles`, `excerpt`) is `MarkedText`, because backends highlight breadcrumbs too — confirmed live in DocSearch's `_highlightResult.hierarchy`. Adapters produce segments via three helpers covering all four backend styles:

| Helper                         | For                                                                                                | Gotchas normalized                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fromTagged(value, pre, post)` | Algolia, Meilisearch `_formatted`, Typesense, Pagefind excerpts                                    | Ask the backend for **sentinel tags** (the Algolia adapter sends `\u0002`/`\u0003`) so indexed text can't collide and no HTML parsing happens. Never assume `<em>`: v2-era DocSearch indices override the index default with a classed `<span>`. |
| `fromRanges(text, ranges)`     | Meilisearch positions, Fuse, Lunr, @orama/highlight                                                | Char offsets, `end` **exclusive**; callers convert (+1 for inclusive ends, byte→char for Meilisearch, word→char for Pagefind). Sorts and clamps overlaps.                                                                                        |
| `fromTerms(text, terms)`       | MiniSearch, FlexSearch (no positions at all — MiniSearch declined offsets as a permanent decision) | Longest-term-first regex so short terms can't shadow longer ones (VitePress's mark.js trick, done on data instead of DOM).                                                                                                                       |

### One `excerpt`, adapter-joined

Elasticsearch-family backends return _arrays_ of fragments per field; a docs row renders one snippet line. Adapters join fragments (`" … "`) into one `MarkedText`; the unjoined form stays in `raw`. Revisit if a multi-fragment UI treatment materializes — slimsearch has one (several matched windows per record) and it reads noisy at docs scale, so the decision stands.

### Flat list + derived grouping, no nesting

The wire format stays **flat** — the only shape every backend can emit. The UI recovers grouping: `group` when present, else page identity (`url` minus anchor — the derivation VitePress and Nuxt UI both use); `kind` drives icons and visual nesting (DocSearch `type` maps `lvl1`→page, `lvl2–6`→heading, `content`→content). Pagefind adapters flatten `sub_results` in page order; every nested UI shape in the wild (DocSearch, Fumadocs, slimsearch) derives from flat engine output. Derivation rule, adopted from Fumadocs: **cap rows per group** — without a cap, one long page monopolises a 12-row modal.

### `url` fused, relative preferred

Anchor included, href-ready — VitePress's id-as-URL trick, with base, rewrites, and `cleanUrls` resolved node-side at build time. Crawler backends store absolute URLs and every SPA integrator independently rewrites them to relative; the rewrite is site-config-aware, so it lives in the client layer (the component's `getRelativePath`; a user-facing `transformResult` hook stays open, §12.2), not the format. Navigate via `router.go()` — the one thing `vitepress-plugin-typesense` forgot, causing full page reloads.

### `total` as `{ count, exact }`

Tri-state: present-and-exact, present-and-estimated (Meilisearch `estimatedTotalHits` — don't render "1–10 of 47" as fact), or absent (FlexSearch). Collapsing these lies to users.

## 3. Adapter contract ([adapter.ts](packages/core/src/adapter.ts))

```ts
interface SearchAdapter {
  name: string
  attribution?: { label: string; url?: string }
  preconnect?: string[]
  load?(ctx: SearchContext): Promise<void> | void
  search(query: string, ctx: SearchContext): Promise<SearchResponse> | SearchResponse
  /** backend-initiated refresh signal; returns unsubscribe */
  onInvalidate?(listener: () => void): () => void
  dispose?(): void
}
```

Modeled on the only genuinely engine-independent contract found (`@algolia/autocomplete`: id + fetcher + projections), but our item is normalized rather than opaque — one shared UI is the whole point.

- `search` may return synchronously (MiniSearch, Fuse, Orama are sync engines); the client `await`s either way. Cancellation is belt-and-braces: `ctx.signal` for remote adapters **plus** a client generation counter, since sync adapters can't abort.
- `load()` is the lazy seam (dynamic-import the SDK, fetch the index chunk); the client memoizes it. Backend SDKs stay out of the eager graph (DocSearch is over a third of a default site's payload): opening a page costs the adapter, never the engine.
- `preconnect` generalizes VitePress's `VPAlgoliaPreconnect` idle-time trick: zero payload, kills the first-search DNS+TLS round trip.
- `onInvalidate` is the tier-upgrade seam: the client re-runs the active query when it fires (the minisearch adapter signals it when the content tier supersedes titles). `dispose()` is declared but never called by the client — the adapter from `virtual:vp-search/adapter` is a module singleton; tearing it down on modal unmount would kill search for the session, so disposal belongs to whoever constructed it.
- Remote adapters may memoize query→response, bounded (Fumadocs caches per URL in an unbounded module `Map` — don't copy that); the worker-local adapter answers sub-ms and needs none.
- `attribution` is **backend-declared, per-adapter** — never a global toggle. Driver: free DocSearch contractually requires visible "Search by Algolia" branding (the logo, not just text); Pagefind/Typesense/Meilisearch/Orama are MIT with none. Renders as fixed footer content today (no attribution → nothing rendered); field vs. slot-only logo fragments is open (§12.3).
- `SearchContext` carries `localeIndex` + `lang` — adapters translate: local adapters pick the per-locale index; the Algolia adapter owns the `lang` facet, stripping every caller-supplied `lang:*` filter (negated and OR-array forms included, dropping arrays the strip empties) and re-injecting `lang:<ctx.lang>` — plus `limit` and `signal`. Lang facet values are index conventions, not BCP tags: the public vitepress index uses `zh-Hans`/`en-US`/bare `ja`, and a mismatch silently returns zero hits. Future scope tags (version filters, neutral-tag translation) would extend context, not results.

The Algolia adapter ([packages/algolia/src/adapter.ts](packages/algolia/src/adapter.ts)) doubles as format validation: plain `fetch` against the REST API (no `algoliasearch`, no Preact — the entire DocSearch UI dependency disappears), sentinel tags, DocSearch-record mapping with `\u200B` cleanup (crawled headings carry zero-width spaces). Caller `searchParams` extend the request but can't break the mapping — `query`, sentinel tags, snippet params, processed `facetFilters`, and the limit-derived `hitsPerPage` are adapter-owned; `attributesToRetrieve` stays overridable as the custom-schema escape hatch. Verified against the live public `vitepress` index by the schema-drift lane (`packages/algolia/test/live/`, §13).

### Where adapters run

Adapters are Vue-free and DOM-free by contract: plain data in, promises out, every environment effect inside `load()`/`search()` — never at module scope — so importing any adapter is SSR-safe by construction. Coupling comes in three tiers:

- **Environment-agnostic** (Algolia, Meilisearch, Typesense — anything speaking HTTP): just `fetch`; runs in Node too.
- **Build-coupled** (MiniSearch and other index-shipping locals): `load()` imports the per-locale index through `virtual:vp-search/*`, so the adapter resolves only inside a Vite build with our node plugin. Still no DOM.
- **Browser-only** (Pagefind): `load()` imports `/pagefind/pagefind.js` from the deployed site, needs the site `base`, and has no dev-mode index — the UI must say so, not silently return nothing.

Client responsibilities never leak into adapters: preconnect `<link>` injection (adapters only declare origins), SPA navigation, query/state persistence, locale reactivity (context is re-read per query), rendered-excerpt harvesting. When an adapter needs site config — Pagefind's `base` — it arrives via adapter options or a `SearchContext` extension, never by importing VitePress runtime modules.

## 4. Per-backend mapping sketch

| Backend                      | `title`/`titles`                                                       | `excerpt`                                                                                | `url`                              | `total`                               | Watch out                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Algolia (DocSearch schema)   | `hierarchy[type]` highlighted; ancestors above it                      | `_snippetResult.content` via `fromTagged`                                                | `url` (absolute → rewrite)         | `nbHits` + `exhaustiveNbHits`         | send sentinel tags; `_highlightResult.hierarchy` omits null levels; text is entity-escaped — decode on ingest     |
| Custom/paid Algolia          | user-supplied transform over their record schema                       | ditto                                                                                    | ditto                              | ditto                                 | the "docsearch doesn't fit" audience; adapter accepts a hit-transform option                                      |
| MiniSearch (local)           | stored `title`/`titles` + `fromTerms(match keys)`                      | stored or refetched text + `fromTerms`                                                   | `id` is the URL (build-time baked) | array length, exact                   | no positions, ever; `storeFields` must include what the UI shows                                                  |
| Pagefind                     | `meta.title` / `sub_results[].title`; no ancestor chain (flat anchors) | `excerpt` is pre-marked `<mark>` HTML, entity-escaped → `fromTagged` + unescape          | `sub_results[].url` ready-made     | `results.length`, exact               | `data()` is lazy per result — hydrate only `limit`; word-index locations; prod-build only (the UI must say so)    |
| Meilisearch (docs-scraper)   | flattened `hierarchy_lvl0..6` keys                                     | `_formatted` via `fromTagged` (or `_matchesPosition` byte→char via `fromRanges`)         | `url`                              | `estimatedTotalHits` → `exact: false` | pagination mode changes response keys; `page_rank` snake_case                                                     |
| Typesense (docsearch schema) | nested `hierarchy.lvl0..6`, `highlight` tree                           | `snippet` via `fromTagged`                                                               | `url`                              | `found`, exact                        | no ellipsis server-side; `text_match` unsafe as number; two highlight shapes (legacy `highlights` vs `highlight`) |
| Orama                        | convention fields (`section`/`title` per schema)                       | `@orama/highlight` positions (+1 inclusive-end) via `fromRanges`; fresh instance per hit | stored `path`                      | `count`, exact                        | core has no highlighting; deprecated plugin-match-highlight                                                       |
| FlexSearch                   | stored doc fields + `fromTerms`                                        | `highlight` template output is **unescaped** — prefer `fromTerms` over parsing it        | stored field                       | omit                                  | default `limit` 100 silently truncates; shape changes with `enrich`/`merge`/`pluck`                               |

## 5. Client-side considerations

What [useSearch.ts](packages/core/src/client/useSearch.ts) wires: debounce (200 ms default), memoized `load`, abort + generation-counter staleness guard (both needed), reset-`load`-on-non-abort-error so a transient failure doesn't brick search (a self-aborted search keeps the load memo and surfaces as an error when its generation is current; a superseded abort stays silent), scope-disposal cleanup.

Component decisions, from the a11y audit of `VPLocalSearchBox`:

- **Adopt**: modal containment via native `<dialog>.showModal()` — focus trap, top layer, dialog semantics, focus restoration for free; backdrop close via manual hit-test; one `nextTick` before focus so a restored query reaches the DOM. Scroll lock as one global `html:has(dialog[open])` rule (`overflow: hidden` + `scrollbar-gutter: stable`) — `:has()` self-arbitrates, no JS refcount. `Teleport to="body"`. Back button closes the modal (`pushState` + `popstate`): the entry unwinds on every non-popstate close with scroll preserved, and Enter-navigation replaces our entry so the stack reads [origin, destination] — two entries would strand the reader on a dead one. IME guard (`e.isComposing`) on Enter; `Ctrl+N/P` on mac; wrapping arrows with `disableMouseOver` arbitration; `aria-activedescendant` roving selection; translations resolved locale→root→defaults (lift `createSearchTranslate`); `prefers-reduced-motion`.
- **Fix (gaps in the audited box)**: `role="button"` on the wrapper is wrong (the input is the combobox; the shell needs `role="dialog"` + `aria-modal`); no result-count live region ("12 results", "no results" go unannounced); `aria-expanded` hardcoded `"true"`; icon-only buttons rely on `title` alone and the detailed-view toggle lacks `aria-pressed`; `aria-label` on result anchors overrides content so marks are never announced and the excerpt is `inert` — segments let us build announcement text properly instead.
- **Theming**: reuse the `--vp-local-search-*` variable namespace where it fits; never copy theme CSS into the package (the abandoned FlexSearch plugin still references long-dead variables — the failure mode).
- **Warm search on intent**: `pointerenter`/`focus` on the trigger starts the dialog chunk + `adapter.load()` (the Ogygia/Fumadocs pattern). Today nothing starts before click + first keystroke + debounce, so the first query pays the entire cold path — the biggest measurable first-query win available.
- **The idle state should offer something**: a curated quick-links option first (Fumadocs `links`), query/result history later (slimsearch keeps 5 of each in localStorage with per-row remove; Tab applies the suggestion). We render only `idleText` today. Query persistence (sessionStorage) and the detailed-view toggle (localStorage) ship as options, like core. Hotkeys become data if the option surface opens (Fumadocs' `{ display, key | predicate }[]`, UA-aware ⌘/Ctrl); we hardcode for now.
- **Rejected: trigger-as-`<a href="/search">`** (Ogygia's pattern). An anchor whose real behavior is "open a dialog" is a role mismatch for AT and middle-click, and its no-JS rationale is void on a pure SSG — the `/search?q=` page can't produce results without JS. No-JS fallbacks are out of scope wholesale; the `/search?q=` page + OpenSearch descriptor (TODO §5) stand on their own, and the trigger stays a button.

Highlighting needs no DOM post-processing — segments render as real `<mark>` elements straight from data; no mark.js, nothing to re-walk. If a core-style rendered-HTML excerpt view ever lands, its mark.js replacement is the CSS Custom Highlight API (`CSS.highlights` + `::highlight()`) — Baseline 2025, one notch past our 2024 floor, degrading to unhighlighted text.

## 6. Node-side considerations

**The index record and the search result are different types** — the seam Nuxt and DocSearch both state. Local backends need a build-time indexer producing corpus records; the adapter joins record + match data into `SearchResult` at query time.

- Corpus record: `{ id, title, titles, text }` + optional `kind` (§2's `kind` won over Nuxt's `level`). VitePress bakes final URLs into `id` at build time (base + rewrites + `cleanUrls` + index-stripping) — kept exactly, and the reason the client never assembles URLs.
- **Index from the configured renderer** — not a bare `new MarkdownIt()` (the Orama plugin's fidelity bug: containers/code-groups vanish) and not scraped built-HTML selectors (the Typesense plugin's coupling; unavailable in dev). Core's `_render`/`_splitIntoSections` hooks are the model; upstream issues to watch: #4979 (indexing runs before other plugins' transforms), #2812 (`@include` missed).
- Honor `search: false` frontmatter as a post-render check (frontmatter populates during render); the Pagefind plugin inventing `pagefind-indexed: false` fragmented the convention. Handle `dynamicRoutes` (core doesn't, #2939).
- Virtual modules are namespaced `virtual:vp-search/*` (two existing plugins already collide on `virtual:search-data`), with null stubs for unused ids so imports never 404. The artifact transport is §11's: a manifest virtual module plus per-locale artifacts over HTTP — hashed static files in builds, `?v=`-busted middleware in dev (the cache-buster lesson core learned the hard way lives on the artifact URL, not a module id).
- Post-build backends hook `buildEnd` **once, guarded** — three plugins monkey-patch it with hand-rolled re-entry latches. Use Pagefind's Node API over its CLI (Starlight's approach).
- Config crossing node→client where functions are involved: an inline JSON-serializable object, or a module path re-exported through a virtual module — never `fnSerialize`/`new Function` (needs CSP `unsafe-eval`). Since the §8b split this applies fully: providers are configured in `.vitepress/config` and instantiated through `virtual:vp-search/adapter`, so every client option crosses JSON-serialized (`clientOptions`' documented constraint); closures survive only inside a `clientModule` file. A third shape if theme code ever needs reactive overrides: VuePress's `defineDocSearchConfig`, a client-side reactive object deep-merged over the build-time defines.
- `optimizeDeps.include` for client deps (`minisearch` etc.) — core does it, no community plugin does, and the dev cold-open waterfalls without it.
- Scale levers, in order: per-locale splitting, artifact splitting (titles eager / content lazy), Web Worker offload, `Intl.Segmenter` for CJK over shipped dictionaries — the ladder §11 ships; core's #5077 proposal aligns.

## 7. VitePress integration

`themeConfig.search.provider` is a closed union with compile-time defines; there is no search slot. Every community plugin therefore hijacks `resolve.alias` on `'./VPNavBarSearch.vue'` — with known holes: the alias misses the second specifier used by `vitepress/theme`'s `without-fonts.ts` path (a live inconsistency in v2), and two search plugins collide silently (alias merge is last-wins).

We ship the alias plugin **covering both specifiers, with collision detection and a helpful warning** — the cheapest differentiator over incumbents — and pursue the real fix upstream: `provider: 'custom'` or a dedicated search slot, which the maintainer position makes feasible. Don't alias `VPNavBarSearchButton` — reusing the theme's own button avoids copying its CSS.

The cheapest upstream shape is VuePress 2's: its default theme renders the `SearchBox` global component when registered, and plugins simply register it — no alias, no config-schema change. A one-line analogue in core's `VPNavBarSearch.vue` would retire the hijack for every plugin (§12.1); the collision story needs an upstream home too — VuePress collides silently, whereas Fumapress hard-errors on a second search plugin, the position an upstream seam should take.

## 8. Packaging

One package per concern under the `@vp-search/*` scope (started as a single package with subpath exports; split per §8b once the second provider landed):

- `@vp-search/core` — `.` types, helpers, `defineSearchAdapter` (server-safe, zero backend deps); `./client/*` Vue components as **raw SFC source** compiled by the consumer's Vite (ecosystem consensus — inherits the user's Vue and scoped-CSS handling); `./node` the `search()` vite plugin + provider contract.
- `@vp-search/<provider>` — `.` the provider factory (node-side); `./adapter` the client adapter module. Backend SDKs are the provider package's own deps, or optional peers dynamically imported inside `load()` for heavy ones — the Orama plugin bundled a second UI runtime plus two engine copies into consumers' bundles, the object lesson.
- CSS splits into importable layers (`variables` separately from component styles) when builds land.
- Peers: `vue` (and optional `vitepress`) with ranges on core; providers peer on `@vp-search/core`. Every incumbent got peer direction wrong somewhere.

### 8b. Meta-plugin split (done)

Core knows how to put a search UI into VitePress and plumb a provider through; providers are separate packages anyone can write, and installing one never installs another's dependencies (the minisearch provider's `minisearch`/`linkedom` must not ride along with an Algolia-only install). Layout (pnpm workspace): `packages/core`, `packages/algolia` (dep-free), `packages/minisearch` (owns `minisearch`, `linkedom`), future `packages/pagefind`, plus `examples/`.

Provider contract (replacing a closed provider union), as implemented in [core/node](packages/core/src/node/index.ts):

```ts
// user config — provider objects, not strings
search(minisearch({ ... }), { translations, locales })

// a provider package's factory returns:
interface ProviderDefinition {
  name: string
  /** default-exports (clientOptions) => SearchAdapter; core instantiates it
   *  through virtual:vp-search/adapter — a module reference, the CSP-safe shape */
  clientModule: string
  /** JSON-serializable; delivered via virtual:vp-search/provider-options */
  clientOptions?: unknown
  /** bare packages clientModule imports at runtime → optimizeDeps.include
   *  chains, so the dev cold-open doesn't waterfall */
  clientDeps?: string[]
  /** node-side participation, all optional */
  node?: {
    setup?(siteConfig: SiteConfig, api: ProviderApi): void
    configureServer?(server: ViteDevServer, api: ProviderApi): void
    /** dev-only; returned ids are invalidated (vite pushes the update) */
    hotUpdate?(file: string, api: ProviderApi): Promise<string[] | void> | string[] | void
  }
}

interface ProviderApi {
  dev: boolean
  assetsBase: string // public URL prefix of emitAsset files
  /** guarded, once-only wraps of siteConfig hooks — core owns the latches;
   *  transformHtml callbacks warn-and-continue on error, buildEnd errors fail
   *  the build; a second search() instance's callbacks are dropped with a
   *  loud warning */
  onTransformHtml(cb: (page: ProviderPage) => void): void
  onBuildEnd(cb: () => Promise<void> | void): void
  /** virtual:vp-search/<provider>/<id>; every unregistered id under
   *  virtual:vp-search/ loads as a null stub so imports never 404 */
  addVirtualModule(id: string, load: () => string | Promise<string>): void
  emitAsset(fileName: string, source: string | Uint8Array): Promise<void> // outDir/vp-search/**
}
```

Core keeps: the alias hijack + collision warning, `virtual:vp-search/{adapter,options,provider-options}`, optimizeDeps/ssr hygiene (core + the provider package, derived from `clientModule`), the UI. The zero-package escape hatch is a bare definition — `search({ name: 'custom', clientModule: './my-adapter.ts' })`, the file default-exporting the same factory a provider package would (a separate `adapterFile` option was dropped as redundant).

Specifier resolution: `clientModule` accepts a bare package specifier, a `virtual:` id, or a file path. Relative paths resolve against the **VitePress project root** (the directory containing `.vitepress` — the base VitePress uses for every user path; vite's root is `srcDir`, and config-dir-relative has no ecosystem precedent — config-relative files go through `import.meta.url`). Resolvability is validated with `this.resolve` in the `load` hook — the only hook with resolver access in dev, build, and SSR — so failures name the option and base, with advice branched by specifier kind, instead of vite erroring on an internal virtual id. `virtual:` ids are emitted raw, never pre-resolved: `\0` is illegal in import specifiers, invisible to the optimizeDeps scanner, and never SSR-externalized — so optimizeDeps/ssr hygiene applies only to bare specifiers, with `clientDeps` degrading to plain `include` entries otherwise. Third parties extend via `SearchAdapter`/helpers from core's root export and `ProviderDefinition`/`ProviderApi` from `@vp-search/core/node`; a custom provider is one package with a factory and a client module, no core changes. Both in-repo providers consume exactly this public contract.

Counter-evidence, recorded: Fumadocs achieves the same dependency isolation in one package — providers as subpath exports over optional peer deps. The split's remaining distinct win is per-provider release cadence and third-party parity (our providers use the identical seam a third party would); the "must not ride along" framing alone would not have forced it.

## 9. Bundled providers

Criteria: covers a distinct architecture cell (remote-API / build-index-local / post-build-static), no heavy mandatory deps, active upstream, docs-convention support. **algolia** (remote, fetch-only) and **minisearch** (local, replaces core local search and reuses its index conventions) are shipped; **pagefind** (post-build static, the best large-site story) is the planned third. Meilisearch/Typesense/Orama/FlexSearch mappings are specified in §4 so community providers are mechanical; a `custom` example will show paid-Algolia-with-own-schema.

## 10. Deliberately omitted (with revisit triggers)

- **Positions on results** — adapter-internal only; revisit if a UI feature needs cross-field mark coordination.
- **`subResults` nesting** — flat + derived grouping; revisit if page-level metadata (Pagefind `meta.image`) earns a UI treatment.
- **`matchedTerms`** — adapters mark text themselves via helpers; revisit for "press Enter to search all of X" affordances.
- **`meta` bag on results** — `raw` suffices until a concrete consumer exists (then: typed slot, Pagefind-style, not a closed object — DocSearch's closed hit type forces casts in every `transformItems`).
- **Pagination** — docs modals render top-N (core: Algolia 20 / local 16); the contract is `limit` + optionally-lazy adapters. Pagefind's hydrate-visible-slice model is the aspiration if "more results" ever ships.
- **Facets/filters in responses** — filtering is request-side (`SearchContext`); response facet counts have no UI.
- **Suggestions/autocomplete** — separate concern, separate contract if ever. The engine cost is ~zero (MiniSearch ships `autoSuggest`; slimsearch returns suggestions in the same worker round trip); the real price is a second response channel and a second keyboard-navigable listbox with its own a11y — what the revisit must weigh.
- **Ask-AI anything** — out of scope, permanently, per project goals.

## 11. Local search adapter

### Engine: MiniSearch v7, swappable behind the adapter

Chosen against measurements on our own docs corpus and core's issue inventory:

- **MiniSearch** — smallest index at full features (0.51× gzip of source text; titles-only tier 100 KB vs 367 KB full on our corpus), prefix + true Levenshtein fuzzy, field boosting, the ranking VitePress users explicitly praise, structured-cloneable serialization (clean worker handoff), pluggable tokenizer, excellent types. Ceilings: offsets permanently declined by the author, no phrase search, no shard merging, dormant-but-stable with bus factor 1 — mitigated by **slimsearch** (Mister-Hope's maintained functional fork, the engine of official VuePress search), which keeps the same index semantics (`loadJSONIndex`, `discard`/`vacuum`, `autoSuggest`): a drop-in escape hatch if MiniSearch dies.
- **Pagefind** — the architecture benchmark (flat ~137–247 KB to first result at any scale, worker by default, charabia CJK better than `Intl.Segmenter`), but no typo tolerance, real-world ranking complaints (an exact `<h1>` match ranked third), a ~52 MB native platform binary, `wasm-unsafe-eval`, and a 1-person bus factor with triage 4:1 behind. Future optional provider for very large sites, not the default.
- **lunr** — the only mature JS engine with offsets-from-index (verified: they survive serialization and compose with `Intl.Segmenter`), but frozen since 2020, positions cost 2× index size, lunr-languages is MPL-1.1 with a native-addon Chinese path, and its largest deployment publicly repudiated it.
- **Orama** — abandoned upstream (team left, npm ownership transferred, a tagged release never published). Its fork **zbsearch** has the best CJK ergonomics tested and is now fumadocs-core's default engine, with `@zbsearch/stemmers`/`@zbsearch/highlight` publishing dep-free — but `@zbsearch/tokenizers` and `@zbsearch/plugin-match-highlight` still ship `workspace:*`, so the offsets path stays blocked; re-check when those publish.
- **FlexSearch** — flat query latency but structurally broken highlighting (maintainer-acknowledged), unigram-only CJK, broken worker+IndexedDB, an unpublished security fix. Fumapress still made it a recommended default — sidestepping the highlight ceiling with client-side regex marking and the CJK one with per-locale encoder presets — an ecosystem hedge on zbsearch worth watching, not a verdict change.
- The fuzzy tier (Fuse/uFuzzy/fzf) is linear scans, not engines. SQLite-FTS5/DuckDB WASM: the engine weighs more than competitors' entire solution and pays sequential B-tree round trips — ruled out with measurements.

The engine sits behind the artifact + worker contracts below, so replacing it (zbsearch later, a positions-bearing format, Pagefind for giant sites) touches neither the UI nor the adapter surface.

### Artifacts

Per locale, emitted as **hashed static assets** (not Vite chunks) under `outDir/vp-search/`:

```
<locale>.titles.<hash>.json    { v: 1, lang, options, index }   // fields: title, titles, group — instant tier
<locale>.content.<hash>.json   { v: 1, lang, options, index }   // + text and extraFields, storeFields incl. text — lazy tier
```

`index` is MiniSearch's serialized JSON string; `options` carries only data — tokenizers are code, supplied identically by the worker, never serialized (the #3685 rule). Records `{ id (site-relative URL with anchor), title, titles, text, group?, kind?, ...extraFields }` are inserted in sorted-route order and the artifact self-hashed, so identical content yields byte-identical artifacts (fixes #4246). The manifest (locale → lang, tier filenames, section count) is embedded in `virtual:vp-search/minisearch/manifest` — inlined in dev; in builds it points at a non-hashed `manifest.json` written at `buildEnd`, since tier filenames aren't known before bundling ends. The provider is named after the engine — `minisearch()` from `@vp-search/minisearch`, not a generic "local"; future local engines ship as their own providers.

Rejected artifact shapes: shipping raw section documents and indexing in the worker on every load (Ogygia's model — pays full tokenize+index per cold visit, exactly what `loadJSON` rehydration and tiering avoid), and inlining the whole multi-locale index into the emitted worker file (slimsearch's build mode — every locale downloads every other, defeating hashing/caching and the IndexedDB plan). Worth _measuring_ in the TODO §6 benchmarks: slimsearch-style record interning (single-char field keys, integer page ids with a side path table, `${pageId}#${anchor}` section ids) — a real artifact-size lever with a real debuggability cost.

### Worker

The local adapter spawns a module worker (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`; Vite bundles it). Protocol:

- `init(base, locale, entry)` — the adapter resolves the locale main-thread and ships one manifest entry. The titles tier loads immediately (search usable), the content tier in the background, announced on arrival (`{ type: 'tier' }`; richer progress reporting stays an open decision, TODO §6).
- `search(id, query, limit?)` → a full `SearchResponse`. Only the limit crosses the wire — `signal`/`lang`/`localeIndex` stay main-thread. Marks are computed **in the worker** via `fromTerms` (matched document terms against stored text; CJK terms come from the same `Intl.Segmenter` tokenizer used at query time), and the excerpt is a windowed `MarkedText` anchored on the first occurrence of the longest — most specific — matching term. The shared format is plain JSON, so responses cross `postMessage` untouched.

The main-thread adapter is a thin correlation-id wrapper implementing `SearchAdapter`; stale responses are dropped by the client's generation guard. (slimsearch is the cautionary variant: `Date.now()` request ids and reject-the-previous-promise cancellation — collision-prone, and callers must catch expected rejections.)

Ranking levers, for the parity pass (TODO §6): index-time field boosts are primary (title 4 / text 2 / titles 1). If the benchmarks reproduce the "page _titled_ with the query ranks below term-dense body text" weakness, the fallback is a bounded worker-side rerank — Ogygia over-fetches `limit*3` and boosts exact-phrase-in-title ×4, all-terms-in-title ×2, heading ×1.5 to fix exactly that. Group _ordering_ in the UI is also undecided: we inherit flat backend order; slimsearch exposes `sortStrategy: 'max' | 'total'` — decide it in the same pass.

### Indexing (build)

Runs after rendering, not before it: a guarded wrap of `siteConfig.buildEnd` + `transformHtml` capture — the hooks core's own plugin cannot use, because its index must be a pre-render Vite chunk. Consequences: dynamic routes are indexed (#2939), Vite `transform` output is indexed (#4979), `$frontmatter` interpolation is indexed (#4934/#3024), and `@include`-class bugs can't recur.

- Content extraction: `contentSelector` option, default `main` (semantic, not theme-class-coupled), parsed with a real HTML parser — never regex against anchor markup (#4609's lesson).
- Sections split on id-bearing headings; **pre-first-heading prose and heading-less pages index under the page URL** (the silent-drop bug in core's approach, fixed here); `search: false` frontmatter honored.
- `group` resolves from the sidebar at index time (a ported `getSidebar` path-prefix resolver; #3192/#3230), HTML stripped from labels.
- `extraFields`: frontmatter fields indexed/stored/boosted by config (#3254). Candidate follow-up: a per-page record hook, Fumapress-style `buildIndex(page) → record` — ours would run node-side, so no serialization constraint.
- Per-locale via rewritten-path bucketing; streaming per-page processing (builds already OOM at 8 GB on huge sites — never hold more than one page's DOM; records and serialized artifact strings do accumulate).
- CJK: `Intl.Segmenter` word segmentation by the locale's lang, the same code at build and query time (#4049).

### Dev

`buildEnd` never fires in dev, so dev uses the cheaper core-style path: markdown-renderer indexing, per-file re-index on HMR, version-busted middleware serving the same artifact shapes. The fidelity gap is pinned per-mode by the e2e fidelity suite: anything Vue evaluates at render (vite transforms, dynamic routes, `$frontmatter` interpolation, `<script setup>` values, data-loader output) reaches only production indexes — dev's renderer emits the literal mustache — and Vue components are unrendered tags in dev, so dev indexes their raw slot text where prod indexes rendered output: different text on component-heavy pages. Not gaps: `@include` partials and `<<<` snippet imports are markdown-it plugins, identical in both modes. One inversion, and a user-facing caveat: **`<ClientOnly>` slots render nothing during SSR, so production search never sees their content** — dev does. Dev skips resolved dynamic routes outright (no source file to read). The allowlist alternative (slimsearch's `CONTENT_BLOCK_TAGS` + `preserveTags`) stays rejected — it loses unlisted components entirely — though ClientOnly shows the skip-list has its own silent drop, on the prod side.

### Ceilings, recorded honestly

- The content tier is one artifact per locale — fine to roughly the low thousands of pages. Beyond that: the Pagefind provider (typo-tolerance tradeoff) or a chunked positions-bearing format (the #5077 / rangefind / docfind direction). Revisit when a real >3k-page site adopts.
- Term-based marking can miss (measured worst case ~17.5% under aggressive normalization; far lower with our lowercase-only pipeline). A build-time mark-coverage check is cheap insurance; index-derived offsets require changing engines.
- IndexedDB artifact caching (search-index's measured 4 ms warm-open) is a v1 candidate.

## 12. Open questions

1. Upstream `provider: 'custom'` in VitePress core vs. alias-only shipping — sequencing, and whether core's search UI could itself consume this format someday. The VuePress-style global-component seam (§7) is the third option, and probably the smallest upstream diff.
2. Where the absolute→relative URL rewrite hook lives (`transformResult` on the component vs. an adapter option) once the real component exists.
3. Attribution: keep the `{ label, url }` field with the slot as override, or drop the field and go slot-only with adapters shipping ready-made logo fragments? (SVGs are needed for DocSearch's requirement either way.)

## 13. Testing

Stack: **Vitest 5.0.0-rc**, adopted at the RC by choice (its floors — vite ≥6.4, node ≥22.12 — are long cleared). The config states `extends: true` and `clearMocks: true` explicitly even though v5 defaults them, so it also runs unmodified on 4.1.11 — the same-day downgrade escape hatch if an RC bug bites. `@vitest/*` companions are pinned exactly in lockstep (their `vitest` peer is exact). Root devDeps carry `vite` + `vue` because vitest/plugin-vue/test-utils peer on them under `strictPeerDependencies`; the tree's vite 8 (rolldown-based) satisfies vitest's peer, so the `esbuild: '-'` override survives.

**Layout.** Tests live under `packages/<pkg>/test/<env>/`, never in `src/` (tsdown's `src/**/*.ts` entry would publish them, and the per-env src tsconfigs would check them under the wrong libs). Each env dir maps 1:1 to a project in the root `vitest.config.ts` — the only config file, since coverage/reporters are root-only. Typechecking: one union `tsconfig.test.json` per package (DOM + node libs — the env-leak guarantee lives on `src`, test code legitimately spans environments, and DOM + WebWorker libs can't coexist in one program anyway). Cross-package alias fixtures and snapshot serializers live in root `test/`.

| project     | environment                       | covers                                                                             |
| ----------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| `shared`    | node, `isolate: false`            | pure ES: highlight, translations, url, engine, tokenize (no side effects anywhere) |
| `client`    | happy-dom + `@vitejs/plugin-vue`  | useSearch, translate, VPMarkedText, VPSearchBox                                    |
| `worker`    | node + `@vitest/web-worker`       | worker protocol, minisearch client adapter                                         |
| `node`      | node                              | core `search()` plugin, indexer, extract, sidebar, dev indexer                     |
| `integrity` | node, requires `pnpm build` first | dist SFC validation, dist entry imports                                            |
| `e2e`       | node driving playwright-core      | dedicated fixture site, dev + build passes                                         |
| `live`      | node, network, env-gated          | Algolia schema-drift contract                                                      |

- **Components: `@vue/test-utils` + happy-dom; browser mode evaluated and deferred** — three packages plus a CI browser install for three SFCs, `vitest-browser-vue` peers `vitest ^4` (uninstallable beside v5 under strict peers), and browser-mode workers collect no coverage. Real-browser truth (`<dialog>` top layer, focus, scrollIntoView) comes from the e2e lane; happy-dom covers render/keyboard/aria logic. Revisit if a bug class ever escapes both layers.
- **Worker: `@vitest/web-worker`** — real `new Worker(new URL(...))` semantics (structuredClone transport, per-test worker instances) in the node environment; its scope proxy falls through to `globalThis`, so `vi.stubGlobal('fetch')` still intercepts tier loads. A held/release fetch gate drives the race tests. Vite's actual worker bundling is e2e's job.
- **`vitepress` and `virtual:vp-search/*` are `resolve.alias`ed to `test/fixtures/*`** in the client project (vitepress's own `@siteData`-to-shims trick): `useData()` throws outside a real app, and the virtuals only exist inside our plugin.
- **Fetch mocking: `vi.stubGlobal` + `unstubGlobals: true`** (the default leaks stubs across tests). MSW rejected: ~41 packages for one endpoint.
- **Snapshots: narrow.** A couple of inline snapshots on excerpt windows; a serializer renders `MarkedText` as `a<mark>b</mark>c` so diffs read as text, not segment-array dumps.
- **E2E follows vitepress's own harness over a dedicated fixture site** in `test/e2e` — its own workspace package owning `vitepress` + `playwright-core`. Not `examples/docs`: that is vendored upstream content, and asserting against it would churn on every sync. globalSetup launches one Chromium server plus the site on an ephemeral port (`provide`/`inject` for the base URL), per-file pages connect over WS, and the same suite runs against dev and built output — the two paths genuinely diverge (inlined dev locales vs fetched hashed artifacts). Readiness by selector, `waitForFunction` over sleeps, `reducedMotion: 'reduce'`, pinned viewport (the browser default is phone-sized). Fixture pages are authored per behavior: locales + CJK, `search: false`, heading-less page, tier-delay via route interception.
- **Algolia: hermetic unit tests over a checked-in captured response, plus the live contract lane** (public search-only key). The live suite asserts the shape of every field the adapter consumes — hierarchy levels and their nullability, `_highlightResult`/`_snippetResult`, sentinel-tag round trip, entity escaping, the `\u200B` quirk, totals — so index/schema drift fails by field name. `skipIf`-gated on `VP_SEARCH_LIVE`; CI runs it nightly, never on PRs.

**Determinism.** `TZ`/`LANG` pinned in `test.env` _and_ CI job env — `test.env` reaches only workers, and only under the default `forks` pool, which also stays because Node `fetch` + the threads pool can't terminate workers and thread-level env is invisible to ICU/V8. CJK tests assert **invariants, not exact boundaries** — `Intl.Segmenter` word boundaries are implementation-defined per ECMA-402, ICU majors land in Node _minors_, and Node's ICU ≠ Chromium's — always with explicit locale tags; an env guard test asserts full-ICU + Segmenter presence so an ICU-flavored failure names itself. This is also what makes exact Node pinning unnecessary.

**CI.** Parallel lanes with no artifact handoff (packages dist is ~232 KB; rebuilding beats a `needs:` chain). `ubuntu-24.04` pinned everywhere: a probe of the 26.04 preview (playwright-supported) hit recurring dev-mode e2e renderer crashes that never occur on 24.04 and was fully reverted — re-probe at GA. The cause was undiagnosed and NOT `/dev/shm`: playwright's default switches already carry `--disable-dev-shm-usage` and nearly all of puppeteer's CI set, so add nothing — and never pass `--disable-features`, which would replace its curated list. Two keepers from that episode: the CI retry condition treats `crashed` as infrastructure noise, and the harness replaces a crashed page on the retry's first visit (one crash otherwise poisons the whole file's shared page). Also: actionlint via the kjanat fork until upstream's label DB learns the 26.04 runner; `playwright install chromium --only-shell` uncached (restore ≈ download at one browser/one job); retry 0 on unit lanes vs condition-gated retries + `trace: 'retain-on-failure'` + failure-only artifact upload on e2e; the `github-actions` reporter re-added explicitly (auto-detection dies the moment `reporters` is set). Nightly: shuffled order with `--sequence.seed` pinned to the run id (vitest never prints its own seed), repeats via a job matrix (no `--repeats` flag exists), plus the live Algolia contract.

**Deferred, with triggers:** browser mode (above); coverage thresholds and `.vue` coverage — start with `src/**/*.ts`, ratchet once suites stabilize (template-region mapping has an open cosmetic issue); `vitest bench` for the TODO §6 benchmarks (bench is exempt from semver and rewritten in v5 — use tinybench directly or wait); `--typecheck`/`expectTypeOf` (tsc/vue-tsc already gate every env, and vitest's typecheck spawns its own tsc that breaks on project references); sharding/blob reports (pays off above roughly 5–8 min per lane; nowhere near).
