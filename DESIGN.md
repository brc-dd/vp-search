# Design: the shared search format

This document records the data-format and architecture decisions, and the research they rest on. Research covered: VitePress's two official implementations (source-level), the third-party VitePress plugin ecosystem plus Docusaurus/Starlight/VuePress/Nuxt Content, and live-verified response schemas for Algolia/DocSearch, Meilisearch, Typesense, Pagefind, Orama, MiniSearch, Fuse.js, FlexSearch, and Lunr. A follow-up survey (2026-08, source-level) read Ogygia (PuruVJ's SvelteKit docs framework), Fumadocs (`fumadocs-core` 16.x), Fumapress (`fumapress@1.0.0`, 2026-08-18 — Fumadocs' Waku/Vite site generator, where search is a plugin), and the VuePress 2 search ecosystem (`@vuepress/plugin-search`, `plugin-docsearch`, `@vuepress/plugin-slimsearch` — the upstreamed successor of theme-hope's search-pro); its findings are folded into the sections below, dated 2026-08.

Scope guard: **search only**. AI answer surfaces (DocSearch askAi, side panels, conversational hits) are out of scope; the format deliberately cannot represent them.

## 1. What is actually universal

Across nine backends, only four things exist everywhere: an id-ish handle, an ordered result list, the source fields, and _some_ notion of relevance ordering. Everything else varies structurally:

- **Highlighting** has four incompatible representations: inline tags (Algolia, Typesense, Pagefind excerpts, Meilisearch `_formatted`), character/byte positions (Meilisearch `_matchesPosition`, Fuse, Lunr, @orama/highlight), matched-term lists only (MiniSearch, Typesense `matched_tokens`), or nothing (FlexSearch core, Orama core).
- **Hierarchy/breadcrumbs** are native nowhere except Pagefind's flat `sub_results`; everywhere else they are scraper/indexer _convention_ (DocSearch `lvl0–6`, VitePress/Nuxt `titles[]`).
- **Totals** are exact (most), estimated (Meilisearch `estimatedTotalHits`), or unknowable (FlexSearch).
- **Scores** are incomparable: Fuse inverts (0 = best), FlexSearch has none, Typesense's `text_match` overflows `Number.MAX_SAFE_INTEGER`, Algolia's ranking is lexicographic rather than scalar.

So the format is: a **required core every backend can fill**, plus optional fields that degrade gracefully, plus `raw` as the escape hatch (the pattern every serious adapter layer uses — Typesense's `_rawTypesenseHit`, InstantSearch's `results`).

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

Three ecosystems converged independently on this exact vocabulary: VitePress local search (`IndexObject.title/titles`), Nuxt Content (`Section.title/titles` — now re-declared structurally by Nuxt UI, evidence it became an interchange contract), and easyops' Docusaurus plugin (`b` breadcrumb array). DocSearch's seven fixed slots — with inconsistent nullability and the `hierarchy_camel`/`hierarchy_radio` quadruplication — is that format's most-criticized wart, and its `type` field conflates record kind with depth. An array breadcrumb carries the same information; `kind` carries the rest.

### `MarkedText` segments, not HTML strings and not positions

```ts
type MarkedText = { text: string; mark?: boolean }[]
```

- **Not HTML strings**: every tag-wrapped format in the survey has scars — InstantSearch's escape-then-reinject dance with an `__escaped` idempotence flag, `dangerouslySetInnerHTML` in DocSearch's Snippet, Nuxt UI hand-escaping `<`/`>` then re-allowing `<mark>`. InstantSearch deprecated its string-returning `highlight()`/`snippet()` helpers and moved to `Array<{ value, isHighlighted }>` parts — this format, arrived at the hard way. slimsearch reinvented it independently (`Word = string | ['mark', text]`). Segments make XSS impossible by construction (the UI renders text nodes), keep mark styling/classes in the UI, and give screen-reader/plain output for free (`textOf`). Counter-example on record (2026-08): Fumadocs went the _other_ way — it deprecated its segment array (`contentWithHighlights`) in favour of markdown strings with `<mark>` injected into the MDAST, so result rows can render inline code and formatting; the price is a markdown renderer shipped to the client and the reopened escaping surface. Known tradeoff, same verdict.
- **Not positions as the primary contract**: three backends (Algolia, Typesense, FlexSearch) cannot produce positions without parsing tags back out, and position _units_ are a minefield — Meilisearch reports UTF-8 **byte** offsets, Fuse and @orama/highlight report **inclusive** ends, Lunr reports `[start, length]`, Pagefind reports **word indices**. Positions exist only as adapter-internal input, normalized by [highlight.ts](packages/core/src/highlight.ts) at the boundary.

Everything displayable (`title`, `titles`, `excerpt`) is `MarkedText`, because backends highlight breadcrumbs too (DocSearch `_highlightResult.hierarchy`) and the live check confirmed marks inside ancestor crumbs. Adapters produce segments via three helpers covering all four backend styles:

| Helper                         | For                                                                                                      | Gotchas normalized                                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fromTagged(value, pre, post)` | Algolia, Meilisearch `_formatted`, Typesense, Pagefind excerpts, FlexSearch templates                    | Ask the backend for **sentinel tags** (the Algolia adapter sends `\u0002`/`\u0003`) so indexed text can't collide and no HTML parsing happens. Never assume `<em>`: v2-era DocSearch indices override the index-level default with `<span class="algolia-docsearch-suggestion--highlight">`. |
| `fromRanges(text, ranges)`     | Meilisearch positions, Fuse, Lunr, @orama/highlight                                                      | Takes char offsets, `end` **exclusive**; callers convert (+1 for inclusive ends, byte→char decode for Meilisearch, word→char accumulation for Pagefind). Sorts and clamps overlaps.                                                                                                          |
| `fromTerms(text, terms)`       | MiniSearch, FlexSearch (no positions at all — MiniSearch declined offsets twice as a permanent decision) | Longest-term-first regex so short terms can't shadow longer ones (VitePress's mark.js trick, done on data instead of DOM).                                                                                                                                                                   |

### One `excerpt`, adapter-joined

Elasticsearch-family backends return _arrays_ of fragments per field and Typesense has `snippets[]`; a docs-search row renders one snippet line. Policy: adapters join fragments (`" … "`) into one `MarkedText`; the unjoined form stays reachable via `raw`. Revisit only if a UI treatment for multiple fragments materializes — one now exists (2026-08): slimsearch renders `display: Word[][]`, several matched windows per record. It reads noisy at docs scale and its windowing is crude (fixed 20/100-char caps), so the decision stands, but the trigger is no longer hypothetical.

### Flat list + derived grouping, no nesting

DocSearch renders two grouping levels (lvl0 section → lvl1 page → child hits via `__docsearch_parent`), Pagefind nests `sub_results` under pages, VitePress local renders flat. The wire format stays **flat** — the only shape every backend can emit — with grouping recoverable by the UI: `group` when present, else page identity (`url` without its anchor — the derivation both VitePress and Nuxt UI already use). `kind` lets the UI pick icons and nest visually (DocSearch's `type` mapped: `lvl1`→page, `lvl2–6`→heading, `content`→content). Pagefind adapters flatten `sub_results` in page order. The 2026-08 survey found two more nested _UI-facing_ shapes — Fumadocs emits a synthetic page row then its section hits (engine `groupBy: page_id`), slimsearch returns `{ title, contents[] }` — but both derive from flat engine output, so the wire-format claim holds. Derivation rule adopted from Fumadocs: **cap rows per group** (it caps at the engine, `groupBy maxResult: 8`, and at Algolia, `attributeForDistinct: page_id` + `distinct`) — without a cap, one long page monopolises a 12-row modal.

### `url` fused, relative preferred

Anchor included, href-ready — the id-as-URL trick VitePress bakes in at build time (base, rewrites, `cleanUrls` resolved node-side). Crawler-based backends store absolute URLs, and _every_ SPA integrator in the survey independently rewrites them (`new URL(url).pathname + hash`, VitePress and Docusaurus each have one). That rewrite is site-config-aware, so it belongs to the client layer (shipped as the component's `getRelativePath`; a user-facing `transformResult` hook stays open, §12.2), not the format. Navigation must go through `router.go()` — the one thing `vitepress-plugin-typesense` forgot, causing full page reloads.

### `total` as `{ count, exact }`

Tri-state: present-and-exact, present-and-estimated (Meilisearch `estimatedTotalHits`, don't render "1–10 of 47" as fact), absent (FlexSearch, which also silently caps at `limit: 100`). Collapsing these lies to users.

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

- `onInvalidate` is the tier-upgrade seam: the client re-runs the active query when it fires (the minisearch adapter signals it when the content tier supersedes titles). `dispose()` is contract-declared but the client never calls it — the adapter from `virtual:vp-search/adapter` is a module singleton, so tearing it down on modal unmount would kill search for the session; disposal belongs to whoever constructed the adapter.

- Modeled on the only genuinely engine-independent contract found (`@algolia/autocomplete`'s source: id + fetcher + projections) — but our item is normalized rather than opaque, because one shared UI is the whole point.
- `search` may return synchronously (MiniSearch, Fuse, Orama are sync engines); the client `await`s either way. Cancellation is belt-and-braces: `ctx.signal` for remote adapters **plus** a generation counter in the client, since sync adapters can't abort.
- `load()` is the lazy seam (dynamic-import the SDK, fetch the index chunk); the client memoizes it. Backend SDKs stay out of the eager graph — the motivating number from VitePress core: DocSearch is "more than 1/3 of the payload" of a default site.
- `preconnect` generalizes VitePress's `VPAlgoliaPreconnect` idle-time trick (zero payload, kills the first-search DNS+TLS round trip).
- Remote adapters may memoize query→response (Fumadocs caches per request URL — in an unbounded module `Map`, so bound ours if adopted); the worker-local adapter answers sub-ms and needs none.
- `attribution` is **backend-declared, per-adapter** — never a global toggle. Attribution renders as fixed footer content today (the slot seam is not built); no attribution, nothing rendered. The ToS driver: the free DocSearch program contractually requires visible "Search by Algolia" branding (the logo, not just text) while Pagefind/Typesense/Meilisearch/Orama are MIT with none — so the slot override is where the official SVG asset goes. Open (§12.3): whether the data field survives at all, vs. slot-only with adapters shipping ready-made logo fragments.
- `SearchContext` carries `localeIndex` + `lang` (adapters translate — the lang facet is the Algolia adapter's own: it strips every caller-supplied `lang:*` filter, negated forms and OR-array members included, dropping arrays the strip empties, and re-injects `lang:<ctx.lang>` when the context carries one; local adapters pick the per-locale index), `limit`, `signal`. Note the lang facet's values are index conventions, not BCP tags — the public vitepress index uses `zh-Hans`/`en-US`/bare `ja`, and a non-matching filter returns zero hits silently. Future scope tags (version filtering, Docusaurus-style neutral tags → per-backend translation) would extend context, not results.

The Algolia adapter ([packages/algolia/src/adapter.ts](packages/algolia/src/adapter.ts)) is implemented as format validation: plain `fetch` against the REST API (no `algoliasearch`, no Preact — the entire DocSearch UI dependency disappears), sentinel highlight tags, DocSearch-record mapping with `\u200B` cleanup (crawled headings carry zero-width spaces from anchor markup). Caller `searchParams` extend the request but can't break the mapping: `query`, the sentinel tags, snippet params, the processed `facetFilters`, and the limit-derived `hitsPerPage` are adapter-owned, while `attributesToRetrieve` stays overridable (the custom-schema escape hatch). Verified live against the public `vitepress` index by the schema-drift contract lane (`packages/algolia/test/live/`, `VP_SEARCH_LIVE=1 pnpm test:live`; nightly in CI).

### Where adapters run

Adapters are Vue-free and DOM-free by contract: plain data in, promises out, and every environment effect inside `load()`/`search()` — never at module scope — so importing any adapter is SSR-safe by construction. Coupling then comes in three tiers:

- **Environment-agnostic** (Algolia, Meilisearch, Typesense — anything speaking HTTP): just `fetch`. Runs in Node too, which is what makes the live example possible.
- **Build-coupled** (MiniSearch and other index-shipping locals): `load()` imports the per-locale index from a `virtual:vp-search/*` module, so the adapter resolves only inside a Vite build that includes our node plugin. Still no DOM.
- **Browser-only** (Pagefind): `load()` imports `/pagefind/pagefind.js` from the deployed site (WASM + chunk fetches relative to the page), needs the site `base`, and has no dev-mode index — the UI must say so instead of silently returning nothing.

Client-specific responsibilities stay in the client layer, never in adapters: preconnect `<link>` injection (adapters only declare origins), SPA navigation (`router.go` on the rendered anchor), query/state persistence, locale reactivity (context is re-read per query), and rendered-excerpt harvesting à la core's detailed view (mounting page components is a client-layer feature layered on top). When an adapter needs site config — Pagefind's `base` — it arrives via adapter options or a `SearchContext` extension, not by the adapter importing VitePress runtime modules.

## 4. Per-backend mapping sketch

| Backend                      | `title`/`titles`                                                       | `excerpt`                                                                                                 | `url`                              | `total`                               | Watch out                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Algolia (DocSearch schema)   | `hierarchy[type]` highlighted; ancestors above it                      | `_snippetResult.content` via `fromTagged`                                                                 | `url` (absolute → rewrite)         | `nbHits` + `exhaustiveNbHits`         | send sentinel tags; `_highlightResult.hierarchy` omits null levels; text is entity-escaped — decode on ingest                                  |
| Custom/paid Algolia          | user-supplied transform over their record schema                       | ditto                                                                                                     | ditto                              | ditto                                 | this is the "docsearch doesn't fit" audience; adapter accepts a hit-transform option                                                           |
| MiniSearch (local)           | stored `title`/`titles` + `fromTerms(match keys)`                      | needs stored or refetched text + `fromTerms`                                                              | `id` is the URL (build-time baked) | array length, exact                   | no positions, ever; `storeFields` must include what the UI shows                                                                               |
| Pagefind                     | `meta.title` / `sub_results[].title`; no ancestor chain (flat anchors) | `excerpt` is pre-marked `<mark>` HTML + entity-escaped → `fromTagged` + unescape                          | `sub_results[].url` ready-made     | `results.length`, exact               | `data()` is lazy per result — hydrate only `limit`; word-index locations; prod-build only (dev must say so in UI, not silently return nothing) |
| Meilisearch (docs-scraper)   | flattened `hierarchy_lvl0..6` keys                                     | `_formatted` via `fromTagged` (or `_matchesPosition` byte→char via `fromRanges`)                          | `url`                              | `estimatedTotalHits` → `exact: false` | pagination mode changes response keys; `page_rank` snake_case                                                                                  |
| Typesense (docsearch schema) | nested `hierarchy.lvl0..6`, `highlight` tree                           | `snippet` via `fromTagged`                                                                                | `url`                              | `found`, exact                        | no ellipsis server-side; `text_match` unsafe as number; two highlight shapes (legacy `highlights` vs `highlight`)                              |
| Orama                        | convention fields (`section`/`title` per schema)                       | `@orama/highlight` positions (+1 inclusive-end) via `fromRanges`; fresh instance per hit (stateful class) | stored `path`                      | `count`, exact                        | core has no highlighting; deprecated plugin-match-highlight                                                                                    |
| FlexSearch                   | stored doc fields + `fromTerms`                                        | `highlight` template output is **unescaped** — prefer `fromTerms` over parsing it                         | stored field                       | omit                                  | default `limit` 100 silently truncates; shape changes with `enrich`/`merge`/`pluck`                                                            |

## 5. Client-side considerations

What [useSearch.ts](packages/core/src/client/useSearch.ts) already wires: debounce (200ms default), memoized `load`, abort + generation-counter staleness guard (both needed; VitePress's `initializeCount` and `onCleanup` patterns), reset-`load`-on-non-abort-error so a transient failure doesn't brick search (a self-aborted search keeps the load memo and surfaces as an error when its generation is current; a superseded abort stays silent), scope-disposal cleanup.

For the real component phase (recorded here from the source-level a11y audit of `VPLocalSearchBox`):

- **Adopt**: modal containment via native `<dialog>.showModal()` — focus trap, top layer, dialog/modal semantics and focus restoration for free, backdrop clicks via a manual hit-test, one `nextTick` before focus so a restored query reaches the DOM (supersedes the surveyed focus-trap-library + double-`nextTick` dance); body scroll lock as one global `html:has(dialog[open])` rule (`overflow: hidden` + `scrollbar-gutter: stable`) — `:has()` self-arbitrates, so the surveyed JS refcount became unnecessary; `Teleport to="body"`; back-button-closes-modal (`pushState` + `popstate`; the entry is unwound on every non-popstate close with the scroll position preserved, and Enter-navigation replaces our own entry so the stack reads [origin, destination]); IME guard (`e.isComposing`) on Enter; `Ctrl+N/P` on mac; wrapping arrow navigation with `disableMouseOver` arbitration; `aria-activedescendant` roving selection; longest-first mark ordering (already in `fromTerms`); translations resolver walking locale→root→defaults in parallel (lift `createSearchTranslate`); `prefers-reduced-motion`.
- **Fix (gaps found in the current box)**: `role="button"` on the wrapper is wrong (input should be the combobox / shell a `role="dialog"` + `aria-modal`); no result-count live region ("12 results", "no results" — currently unannounced); `aria-expanded` hardcoded `"true"`; icon-only buttons rely on `title` only, toggle lacks `aria-pressed`; `aria-label` on result anchors overrides content so marks are never announced and the excerpt is `inert` — segments let us build announcement text properly instead.
- **Theming**: reuse the `--vp-local-search-*` variable namespace where it fits; never copy theme CSS into the package (the abandoned FlexSearch plugin still references variables dead for years — that's the failure mode).
- Query persistence (sessionStorage) and detailed-view toggle (localStorage) as options, like core.
  From the 2026-08 survey (Ogygia / Fumadocs / slimsearch):

- **Warm search on intent**: `pointerenter`/`focus` on the trigger should start the dialog chunk + `adapter.load()` (Ogygia wakes its palette exactly this way; Fumadocs preloads the dialog at mount). Today nothing starts before click + first keystroke + debounce, so the first query pays the entire cold path — the biggest measurable first-query win available.
- **The idle state should offer something**: a curated quick-links option first (Fumadocs `links`, shown when the query is empty), query/result history later (slimsearch keeps 5 of each in localStorage with per-row remove; Tab applies the highlighted suggestion). We currently render only `idleText`.
- Hotkeys as data if the option surface ever opens: Fumadocs' `{ display, key | predicate }[]` with a UA-aware ⌘/Ctrl display component; slimsearch takes `hotKeys` too. Core and we both hardcode.
- Ogygia's trigger-as-`<a href="/search">` pattern was considered and **rejected** (2026-08): an anchor whose real behavior is "open a dialog" is a role mismatch (`role`/behavior disagree for AT and for middle-click expectations), and its no-JS rationale is void here — we ship on a pure SSG, so the `/search?q=` page itself cannot produce results without JS, and half the default theme is inert without JS anyway. No-JS fallbacks are out of scope wholesale. The `/search?q=` page + OpenSearch descriptor (TODO §5) stand on their own; the navbar trigger stays a button that opens the dialog.

- Highlighting needs no DOM post-processing in this design — segments render as real `<mark>` elements straight from data, so there is no mark.js and nothing to re-walk. If the core-style rendered-HTML excerpt view ever lands (mounting page modules and slicing by heading), the modern replacement for mark.js there is the **CSS Custom Highlight API** (`CSS.highlights` + `::highlight()`): term highlighting over arbitrary rendered DOM with zero mutation, styled via theme vars. Caveat: it reached Baseline only in 2025 (Firefox 140), a notch past our Baseline 2024 floor — fine by the time that feature exists, and it degrades to simply-unhighlighted text.

## 6. Node-side considerations

The corpus/envelope seam, stated by the prior art (Nuxt's `SearchResult = Section + rank + snippets`, DocSearch's `StoredDocSearchHit = Omit<hit, highlight/snippet>`): **the index record and the search result are different types**. Local backends need a build-time indexer producing corpus records; the adapter joins record + match data into `SearchResult` at query time.

- Corpus record follows the convergent shape: `{ id, title, titles, text }` (+ optional `kind` as shipped; Nuxt's `level` was the surveyed variant — §2's `kind` won). VitePress bakes final URLs into `id` at build time (base + rewrites + `cleanUrls` + index-stripping) — keep exactly that; it's why the client never assembles URLs.
- **Index from the configured renderer**, not a bare `new MarkdownIt()` (the Orama plugin's fidelity bug: containers/code-groups vanish) and not scraped built HTML selectors (Typesense plugin's coupling; unavailable in dev). Core's `_render`/`_splitIntoSections` hooks are the model; upstream issues to watch: #4979 (indexing runs before other plugins' transforms), #2812 (`@include` missed).
- Honor `search: false` frontmatter (core's convention — post-render check, since frontmatter populates during render; the Pagefind plugin inventing `pagefind-indexed: false` fragmented this). Handle `dynamicRoutes` (core doesn't, #2939 — the Pagefind plugin does).
- Virtual modules, namespaced `virtual:vp-search/*` (two existing plugins already collide on `virtual:search-data`). The shipped artifact transport is §11's — one manifest virtual module plus per-locale artifacts fetched over HTTP (hashed static files in builds, `?v=`-busted middleware in dev; the cache-buster lesson core learned the hard way now lives on the artifact URL, not a module id). Stub modules when unused so imports never 404.
- Post-build backends (Pagefind) hook `buildEnd` **once, guarded** — three plugins monkey-patch it with hand-rolled re-entry latches; use Pagefind's Node API over its CLI (Starlight's approach).
- Config crossing node→client where functions are involved: the two-shape union that Typesense's plugin and `starlight-docsearch` converged on independently — inline JSON-serializable object, or a module path re-exported through the virtual module. Never `fnSerialize`/`new Function` (needs CSP `unsafe-eval`). Note: since the §8b split this applies fully — providers are configured in `.vitepress/config` and instantiated by core through `virtual:vp-search/adapter`, so every client option crosses node→client JSON-serialized (`clientOptions`' documented constraint); closures survive only inside a `clientModule` file itself. A third shape worth knowing (2026-08): VuePress's docsearch plugin layers a client-side runtime config API on top — `defineDocSearchConfig(objectRefOrGetter)`, a reactive object deep-merged over the build-time defines, per-locale by `routeLocale` — the candidate if theme code ever needs to override translations/limits reactively rather than from `.vitepress/config`.
- `optimizeDeps.include` for client deps (`minisearch` etc.) — core does, no community plugin does, dev cold-open waterfalls result.
- Scale headroom (core's #5077 proposal aligns): per-locale splitting first, then artifact splitting (titles eager / content lazy), Web Worker offload, `Intl.Segmenter` for CJK rather than shipping dictionaries.

## 7. VitePress integration

`themeConfig.search.provider` is a closed union with compile-time defines; there is no search slot. Every community plugin therefore hijacks `resolve.alias` on `'./VPNavBarSearch.vue'` — with known holes: the aliased specifier misses the `vitepress/theme` named-export path (`without-fonts.ts` uses a different specifier — live inconsistency in v2), and two search plugins collide silently (alias merge is last-wins).

Plan: ship the alias-based vite plugin (covering **both** specifiers, with explicit collision detection and a helpful warning — the cheapest differentiator over incumbents), and pursue the real fix upstream in core: `provider: 'custom'` or a dedicated `search` slot/named alias, which the maintainer position makes feasible. Don't alias `VPNavBarSearchButton` — reusing the theme's own button avoids copying its CSS.

VuePress 2 shows the cheaper upstream shape (2026-08): its default theme renders `hasGlobalComponent('SearchBox') ? resolveComponent('SearchBox') : () => null`, and every search plugin simply registers that global component from its client config — no alias, no config-schema change. A one-line analogue in core's `VPNavBarSearch.vue` would retire the hijack for every plugin; probably a smaller upstream ask than `provider: 'custom'` (§12.1). Its downside is ours minus the warning: two plugins still fight, just silently (last registration wins), so the collision story would need a home upstream too. Fumapress shows what that home looks like when the framework owns the seam: its plugin contract passes each plugin the finalized plugin list at `preinit`, and each search plugin **throws** on finding another ("only one search plugin can be added") — collision as a structural hard error, the position an upstream `search` slot should take.

## 8. Packaging

One package per concern under the `@vp-search/*` scope (started as a single package with subpath exports — the `@docsearch/react` / `meilisearch-docsearch` granularity precedent — split per §8b once the second provider landed):

- `@vp-search/core` — `.` types, helpers, `defineSearchAdapter` (server-safe, zero backend deps); `./client/*` Vue components, shipped as **raw SFC source** compiled by the consumer's Vite (ecosystem consensus; inherits the user's Vue + scoped-CSS handling); `./node` the `search()` vite plugin + provider contract
- `@vp-search/<provider>` — `.` the provider factory (node-side); `./adapter` the client adapter module. Backend SDKs are the provider package's own deps (or optional peers dynamically imported inside `load()` for heavy ones — the Orama plugin is the object lesson against bundling: a second UI runtime plus two engine copies in consumers' bundles)
- CSS split into importable layers (`variables` separately from component styles) when builds land
- Peers: `vue` (and `vitepress` optional) with ranges on core; providers peer on `@vp-search/core` — every incumbent got peer direction wrong somewhere

### 8b. Meta-plugin split (decided 2026-08, executed 2026-08 after the minisearch adapter landed)

The end-state is a **meta plugin**: the core knows how to put a search UI into VitePress and how to plumb a provider through; providers are separate packages anyone can write, and installing one never installs another's dependencies (the minisearch provider's `minisearch`/`linkedom` must not ride along with an Algolia-only install).

Monorepo layout (pnpm workspace): `packages/core` (UI, shared format/types/helpers, translations, the node plugin shell), `packages/algolia` (dep-free), `packages/minisearch` (owns `minisearch`, `linkedom`), future `packages/pagefind` etc., plus `examples/`. Publish naming decided with the split: the `@vp-search/*` scope, core as `@vp-search/core`.

Provider contract (replaced the closed provider union in plugin options), as implemented in [core/node](packages/core/src/node/index.ts):

```ts
// user config
search(minisearch({ ... }), { translations, locales })   // provider objects, not strings

// provider package exports a factory returning:
interface ProviderDefinition {
  name: string
  /** module specifier whose default export is a factory (clientOptions) => SearchAdapter;
   *  core instantiates it through virtual:vp-search/adapter (the CSP-safe
   *  module-reference shape) */
  clientModule: string
  /** JSON-serializable options the client factory receives via
   *  virtual:vp-search/provider-options */
  clientOptions?: unknown
  /** bare packages clientModule imports at runtime — core turns them into
   *  optimizeDeps.include chains so the dev cold-open doesn't waterfall */
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
  assetsBase: string  // public URL prefix of emitAsset files
  /** guarded, once-only wrapping of siteConfig hooks — core owns the latches;
   *  transformHtml callbacks warn-and-continue on error, buildEnd errors fail
   *  the build; a second search() instance's callbacks are dropped with a
   *  loud warning */
  onTransformHtml(cb: (page: ProviderPage) => void): void
  onBuildEnd(cb: () => Promise<void> | void): void
  /** namespaced virtual modules: virtual:vp-search/<provider>/<id>;
   *  every unregistered id under virtual:vp-search/ loads as a null stub so
   *  an inactive provider's imports never 404 */
  addVirtualModule(id: string, load: () => string | Promise<string>): void
  emitAsset(fileName: string, source: string | Uint8Array): Promise<void>   // outDir/vp-search/**
}
```

Core keeps: alias hijack + collision warning, `virtual:vp-search/{adapter,options,provider-options}`, optimizeDeps/ssr hygiene (core + the provider package, derived from `clientModule`), the UI. The zero-package escape hatch is a bare definition — `search({ name: 'custom', clientModule: './my-adapter.ts' })`, the file default-exporting the same factory shape a provider package would (a separate `adapterFile` option existed briefly and was dropped as redundant once `clientModule` resolved paths properly).

Specifier resolution (2026-08, decided against vite 8/rolldown, rollup, and plugin-ecosystem source): `clientModule` accepts a bare package specifier, a `virtual:` id, or a file path. Relative paths resolve against the **VitePress project root** (the directory containing `.vitepress` — the same base VitePress uses for every user path; vite's root is `srcDir`, and config-dir-relative options have zero ecosystem precedent — config-relative files go through `import.meta.url`). Resolvability is validated with `this.resolve` in the `load` hook — the only hook with resolver access in dev, build, and SSR — so failures name the option and base instead of vite erroring on our internal virtual id, with advice branched by specifier kind (bare → check the provider package; path → the project-root rule; `virtual:` → its own note). `virtual:` ids are emitted raw and never pre-resolved: `\0` is illegal in import specifiers, invisible to the optimizeDeps scanner, and never SSR-externalized — which also means optimizeDeps/ssr hygiene applies only to bare specifiers, with `clientDeps` degrading to plain `include` entries otherwise. Type extension points for third parties: `SearchAdapter`/`SearchResult`/helpers from core's root export, `ProviderDefinition`/`ProviderApi` from `@vp-search/core/node` — a custom provider is one package with a factory and a client module, no core changes. Both in-repo providers consume exactly this public contract.

Counter-evidence, recorded for honesty (2026-08): Fumadocs, at much larger scale, keeps one package — providers as subpath exports with backends as **optional peer deps** (`algoliasearch`, `flexsearch`, …) — achieving the same dependency isolation without a monorepo. The split's remaining distinct win is per-provider release cadence and third-party parity (our providers and theirs use the identical seam); the "must not ride along" framing alone would not have forced it.

## 9. Out-of-the-box adapters (deferred decision)

Criteria: covers a distinct architecture cell (remote-API / build-index-local / post-build-static), no heavy mandatory deps, active upstream, docs-convention support. Current candidates: **algolia** (done — remote, fetch-only), **minisearch** (local, replaces core local search, reuses its index conventions), **pagefind** (post-build static, best large-site story). Meilisearch/Typesense/Orama/FlexSearch mappings are specified above so community adapters are mechanical; a `custom` example shows paid-Algolia-with-own-schema.

## 10. Deliberately omitted (with revisit triggers)

- **Positions on results** — adapter-internal only; revisit if a UI feature needs cross-field mark coordination.
- **`subResults` nesting** — flat + derived grouping; revisit if page-level metadata (Pagefind `meta.image`) earns a UI treatment.
- **`matchedTerms`** — adapters mark text themselves via helpers; revisit for "press Enter to search all of X" affordances.
- **`meta` bag on results** — `raw` suffices until a concrete consumer exists (then: typed slot, Pagefind-style, not a closed object — DocSearch's closed hit type forces casts in every `transformItems`).
- **Pagination** — docs modals render top-N (core: Algolia 20 / local 16); the contract is `limit` + optionally-lazy adapters. Pagefind's hydrate-visible-slice model is the aspiration if "more results" ever ships.
- **Facets/filters in responses** — filtering is request-side (`SearchContext`); response facet counts have no UI.
- **Suggestions/autocomplete** (`autoSuggest`) — separate concern, separate contract if ever. 2026-08 evidence that the _engine_ cost is ~zero: MiniSearch ships `autoSuggest`, and slimsearch returns suggestions in the same worker round trip (`suggestDelay: 0` vs `searchDelay: 150`, Tab applies). The real price is the contract — a second response channel and a second keyboard-navigable listbox with its own a11y — which is what the revisit must weigh.
- **Ask-AI anything** — out of scope, permanently, per project goals.

## 11. Local search adapter

### Engine: MiniSearch v7, swappable behind the adapter

Decided against the August 2026 survey (measured on our own docs corpus) and the core issue inventory:

- **MiniSearch**: smallest index at full features (0.51× gzip of source text; titles-only tier 100 KB vs 367 KB full on our corpus), prefix + true Levenshtein fuzzy, field boosting, the ranking VitePress users explicitly praise (#2939 thread), structured-cloneable serialization (clean worker handoff), pluggable tokenizer, excellent types. Ceilings: offsets permanently declined (4 issues; author restated 2025), no phrase search, no shard merging, dormant-but-stable (bus factor 1) — mitigated 2026-08: **slimsearch** (Mister-Hope's maintained functional fork, the engine of official VuePress search) keeps the same index semantics (`loadJSONIndex`, `discard`/`vacuum`, `autoSuggest`), so a drop-in escape hatch exists if MiniSearch dies.
- **Pagefind**: the architecture benchmark (flat ~137–247 KB to first result at any scale, worker default, charabia CJK better than `Intl.Segmenter`) but no typo tolerance, real-world ranking complaints (exact `<h1>` match ranked third), a ~52 MB native platform binary, `wasm-unsafe-eval`, and a 1-person bus factor with triage 4:1 behind. Future optional adapter for very large sites, not the default.
- **lunr**: only mature JS engine with offsets-from-index (verified, survives serialization, composes with `Intl.Segmenter`) — but frozen since 2020, positions cost 2× index, lunr-languages is MPL-1.1 with a native-addon Chinese path, and its largest deployment publicly repudiated it.
- **Orama**: abandoned upstream (team left 2026-02, npm ownership transferred, tagged release unpublished); last real release 3.1.18 (2025-12-19) — yet Ogygia (2026) still defaults to `@orama/orama ^3` as an optional peer. Its fork **zbsearch** has the best CJK ergonomics tested; re-checked 2026-08: `zbsearch@4` (2026-08-11) is now **fumadocs-core's default engine** (a hard dependency there), and `@zbsearch/stemmers`/`@zbsearch/highlight` publish dep-free — but `@zbsearch/tokenizers` and `@zbsearch/plugin-match-highlight` still ship `workspace:*`, so the offsets path stays blocked; next re-check when those publish. **FlexSearch**: flat query latency but structurally broken highlighting (maintainer-acknowledged), unigram-only CJK, worker+IndexedDB broken, unpublished security fix. Yet Fumapress v1 (2026-08, Fumadocs' own site generator) made FlexSearch — not zbsearch — its recommended-preset default, sidestepping the highlight ceiling by regex-marking query terms client-side and the CJK one via per-locale encoder presets (`localeMap: 'cjk'`); an ecosystem hedge on zbsearch worth watching, not a verdict change. Fuzzy tier (Fuse/uFuzzy/fzf): linear scans, not engines. SQLite-FTS5/DuckDB WASM: engine weighs more than competitors' entire solution; sequential B-tree round trips; ruled out with measurements.

The engine sits behind the artifact + worker contracts below, so replacing it (zbsearch later, a positions-bearing custom format, Pagefind for giant sites) does not touch the UI or adapter surface.

### Artifacts

Per locale, emitted as **hashed static assets** (not Vite chunks) under `outDir/vp-search/`:

```
<locale>.titles.<hash>.json    { v: 1, lang, options, index }   // fields: title, titles, group — instant tier
<locale>.content.<hash>.json   { v: 1, lang, options, index }   // + text and extraFields, storeFields incl. text — lazy tier
```

`index` is MiniSearch's serialized JSON string; `options` carries only data (fields, storeFields, searchOptions defaults) — tokenizers are code, supplied identically by the worker (never serialized; the #3685 rule). Records: `{ id (site-relative URL with anchor), title, titles, text, group?, kind?, ...extraFields }`, inserted in sorted-route order and self-hashed → byte-identical artifacts for identical content (fixes #4246). The manifest (locale → { lang, tier filenames, section count }) is embedded in `virtual:vp-search/minisearch/manifest` (inlined in dev; in builds it points at a non-hashed `manifest.json` written at `buildEnd`, since tier filenames aren't known before bundling ends). The provider is named after the engine — `minisearch()` from `@vp-search/minisearch` — not a generic "local": future local engines ship as their own separate providers.

Two artifact shapes surveyed 2026-08 and rejected: shipping raw section documents and building the engine index in the worker on every load (Ogygia — pays full tokenize+index per cold visit, exactly what `loadJSON` rehydration and tiering exist to avoid), and inlining the whole multi-locale index into the emitted worker file (slimsearch's build mode — every locale downloads every other, and it defeats hashing/caching and the IndexedDB plan). Fumapress's static mode sits between: FlexSearch's native keyed `export()`, re-`import()`ed piecewise client-side — engine-prebuilt like ours, but still one all-locales payload on the wire. Worth _measuring_ in the TODO §6 benchmarks before adopting: slimsearch-style record interning (single-char field keys, integer page ids with a side path table, section ids as `${pageId}#${anchor}`) — a real artifact-size lever with a real debuggability cost.

### Worker

The local adapter spawns a module worker (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`; Vite bundles it). Protocol: `init(base, locale, entry)` — the adapter resolves the locale main-thread and ships one manifest entry — loads the titles tier immediately (search usable), content tier in the background, announced on arrival (`{ type: 'tier' }`; richer progress reporting is an open decision, TODO §6); `search(id, query, limit?)` — only the limit crosses the wire, `signal`/`lang`/`localeIndex` stay main-thread — → full `SearchResponse` — marks are computed **in the worker** via `fromTerms` (matched document terms against stored text; CJK terms come from the same `Intl.Segmenter` tokenizer used at query time), and the excerpt is a windowed `MarkedText` around the first occurrence of the longest matching term (the window anchors on the most specific match). Since the shared format is plain JSON, the response crosses `postMessage` untouched. Main-thread adapter is a thin correlation-id wrapper implementing `SearchAdapter`; stale responses are dropped by the client's existing generation guard. (slimsearch's protocol is the cautionary variant: `Date.now()` request ids and reject-the-previous-promise cancellation — collision-prone and forces callers to catch expected rejections.)

Ranking levers, recorded for the parity pass (TODO §6): index-time field boosts are the primary lever (title 4 / text 2 / titles 1). Ogygia instead over-fetches `limit*3` and hand-reranks (exact-phrase-in-title ×4, all-terms-in-title ×2, heading ×1.5) — built to fix exactly the "page _titled_ with the query ranks below term-dense body text" complaint recorded against Pagefind above. If the parity benchmarks reproduce that weakness here, a bounded worker-side rerank is the fallback. Also unstated today: group _ordering_ in the UI — slimsearch exposes `sortStrategy: 'max' | 'total'` over sub-scores, we inherit flat backend order — decide it in the same pass.

### Indexing (build)

Runs after rendering, not before it: a guarded wrap of `siteConfig.buildEnd` + `transformHtml` capture (the hooks core's own plugin cannot use because its index must be a pre-render Vite chunk). Consequences: dynamic routes are indexed (#2939), Vite `transform` output is indexed (#4979), `$frontmatter` interpolation is indexed (#4934/#3024), `@include`-class bugs can't recur.

- Content extraction: `contentSelector` option, default `main` (semantic, not theme-class-coupled), parsed with a real HTML parser — never regex against anchor markup (#4609's lesson).
- Sections: split on id-bearing headings; **pre-first-heading prose and heading-less pages index under the page URL** (fixes the silent-drop bug found in #4049's thread); `search: false` frontmatter honored.
- `group` resolved from the sidebar at index time (ported `getSidebar` path-prefix resolver; #3192/#3230/PR #3440), HTML stripped from labels.
- `extraFields`: frontmatter fields indexed/stored/boosted by config (#3254). Candidate follow-up (2026-08): a per-page record hook — Fumapress's search plugins expose exactly one user seam, `buildIndex(page) → record` (defaulting to a capability-keyed ask of the content adapters). Ours would run node-side at index time, so no serialization constraint applies.
- Per-locale via rewritten-path locale bucketing; streaming per-page processing (build already OOMs at 8 GB on huge sites — never accumulate more than one page's DOM; the streamed thing is the DOM only — records and the serialized per-locale artifact strings do accumulate).
- CJK: `Intl.Segmenter` word segmentation by the locale's lang, applied at build and query time by the same code (#4049).

### Dev

`buildEnd` never fires in dev, so dev uses the cheaper core-style path: markdown-renderer-based indexing with per-file re-index on HMR and version-busted middleware serving of the same artifact shapes. Documented fidelity gap, pinned per-mode by the e2e fidelity suite (2026-08): anything Vue evaluates at render — vite transforms, dynamic routes, `$frontmatter` interpolation, `<script setup>` values, data-loader output — reaches only production indexes (dev's renderer emits the literal mustache), while Vue components are unrendered tags in dev, so the extractor indexes their raw slot text where prod indexes rendered output: dev and prod index _different text_ on component-heavy pages. Not gaps: `@include` partials and `<<<` snippet imports are markdown-it plugins, expanded identically in both modes. One inversion, and a user-facing caveat: **`<ClientOnly>` slots render nothing during SSR, so production search never sees their content** — dev does. Dev skips resolved dynamic routes outright (no source file to read). The allowlist alternative (slimsearch's `CONTENT_BLOCK_TAGS` + `preserveTags`) stays rejected — it loses unlisted components entirely — though ClientOnly shows the skip-list path has its own silent drop, on the prod side.

### Ceilings, recorded honestly

- The content tier is still one artifact per locale — right up to roughly the low thousands of pages. Beyond that: the Pagefind adapter (typo-tolerance tradeoff) or a chunked positions-bearing format (the #5077 / rangefind / docfind direction). Revisit when a real >3k-page site adopts.
- Term-based marking can miss (measured worst case ~17.5% with aggressive normalization; far lower with our lowercase-only pipeline). A build-time mark-coverage check is cheap insurance; index-derived offsets require changing engines.
- IndexedDB artifact caching (search-index's measured 4 ms warm-open) is a v1 candidate.

## 12. Open questions

1. Upstream `provider: 'custom'` in VitePress core vs. alias-only shipping — sequencing, and whether core's search UI could itself consume this format someday. The VuePress-style global-component seam (§7) is the third option, and probably the smallest upstream diff.
2. Where the absolute→relative URL rewrite hook lives (`transformResult` on the component vs. adapter option) once the real component exists.
3. Attribution: keep the `{ label, url }` field with the slot as override, or drop the field and go slot-only with adapters shipping ready-made logo fragments (SVGs are needed for DocSearch's requirement either way)?

## 13. Testing (decided 2026-08; §13 appended after §12 so the §12.x references above and in TODO stay stable)

Stack: **Vitest 5.0.0-rc** (adopted at the RC by choice, ahead of stable; its floors — vite ≥6.4, node ≥22.12 — are long cleared). The config states `extends: true` and `clearMocks: true` explicitly even though v5 defaults them, so it also runs unmodified on 4.1.11 — the same-day downgrade escape hatch if an RC bug bites. `@vitest/*` companions pinned exactly in lockstep (their `vitest` peer is exact). Root devDeps gain `vite` + `vue` because vitest/plugin-vue/test-utils peer on them and `strictPeerDependencies` is on; the tree's vite 8 (rolldown-based) satisfies vitest's peer, so the `esbuild: '-'` override survives untouched.

**Layout.** Tests live under `packages/<pkg>/test/<env>/`, never in `src/` (tsdown's `src/**/*.ts` entry would publish them, and the per-env src tsconfigs would check them under the wrong libs). Each env dir maps 1:1 to a project in the root `vitest.config.ts` — the only config file, since coverage/reporters are root-only in v4. Typechecking: one union `tsconfig.test.json` per package (DOM + node libs; the env-leak guarantee lives on `src`, test code legitimately spans environments, and DOM + WebWorker libs can't coexist in one program anyway). Cross-package alias fixtures and snapshot serializers live in root `test/`.

| project     | environment                       | covers                                                                             |
| ----------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| `shared`    | node, `isolate: false`            | pure ES: highlight, translations, url, engine, tokenize (no side effects anywhere) |
| `client`    | happy-dom + `@vitejs/plugin-vue`  | useSearch, translate, VPMarkedText, VPSearchBox                                    |
| `worker`    | node + `@vitest/web-worker`       | worker protocol, minisearch client adapter                                         |
| `node`      | node                              | core `search()` plugin, indexer, extract, sidebar, dev indexer                     |
| `integrity` | node, requires `pnpm build` first | dist SFC validation (ex-`validate-sfc.ts`), dist entry imports                     |
| `e2e`       | node driving playwright-core      | dedicated fixture site, dev + build passes                                         |
| `live`      | node, network, env-gated          | Algolia schema-drift contract                                                      |

- **Components: `@vue/test-utils` + happy-dom; browser mode evaluated and deferred.** Browser mode is stable in v4, but costs three packages plus a CI browser install for three SFCs, `vitest-browser-vue` peers `vitest ^4` (uninstallable beside v5 under strict peers), and browser-mode workers collect no coverage. Real-browser truth (`<dialog>` top-layer, focus, scrollIntoView) comes from the e2e lane; happy-dom covers render/keyboard/aria logic. Revisit if a bug class ever escapes both layers.
- **Worker: `@vitest/web-worker`** replaces the scratch-era hand-rolled `self` stub: real `new Worker(new URL(...))` semantics (structuredClone transport, per-test worker instances) in the node environment, and its scope proxy falls through to `globalThis`, so `vi.stubGlobal('fetch')` still intercepts tier loads. The held/release fetch gate for race tests carries over. Vite's actual worker bundling is e2e's job.
- **`vitepress` and `virtual:vp-search/*` are `resolve.alias`ed to `test/fixtures/*`** in the client project (vitepress's own `@siteData` → shims trick): `useData()` throws outside a real app, and the virtuals only exist inside our plugin.
- **Fetch mocking: `vi.stubGlobal` + `unstubGlobals: true`** (the default leaks stubs across tests). MSW rejected: ~41 packages for one endpoint.
- **Snapshots: narrow.** A couple of inline snapshots on excerpt windows; a serializer renders `MarkedText` as `a<mark>b</mark>c` so diffs read as text, not segment-array dumps.
- **E2E follows vitepress's own harness** over a **dedicated fixture site** in `test/e2e` — its own workspace package owning `vitepress` + `playwright-core` (`examples/docs` is vendored upstream content; asserting against it would churn on every sync). globalSetup launches one Chromium server plus the site on an ephemeral port (`provide`/`inject` for the base URL), per-file pages connect over WS, and the same suite runs against dev and built output — the two paths genuinely diverge (inlined dev locales vs fetched hashed artifacts). Readiness by selector, `waitForFunction` over sleeps, `reducedMotion: 'reduce'`, pinned viewport (vitest's browser default is phone-sized). Fixture pages are authored per behavior: locales + CJK, `search: false`, heading-less page, tier-delay via route interception.
- **Algolia: hermetic unit tests over a checked-in captured response, plus a live contract lane** using the public search-only key. The live suite asserts the shape of every field the adapter consumes (hierarchy levels and their nullability, `_highlightResult`/`_snippetResult`, sentinel-tag round-trip, entity escaping, the `\u200B` quirk, totals) so index/schema drift fails by field name. `skipIf`-gated on `VP_SEARCH_LIVE`; CI runs it nightly, never on PRs.

**Determinism.** `TZ`/`LANG` pinned in `test.env` _and_ CI job env (`test.env` reaches only workers, and only under the default `forks` pool — which also stays because Node `fetch` + the threads pool can't terminate workers, and thread-level env is invisible to ICU/V8). CJK tests assert **invariants, not exact boundaries** — `Intl.Segmenter` word boundaries are implementation-defined per ECMA-402, ICU majors land in Node _minors_, and Node's ICU ≠ Chromium's — always with explicit locale tags; an env guard test asserts full-ICU + Segmenter presence so an ICU-flavored failure names itself. This is also what makes exact Node pinning unnecessary.

**CI.** Parallel lanes with no artifact handoff (packages dist is ~232 KB; rebuilding beats a `needs:` chain), `ubuntu-26.04` pinned (adopted 2026-08 while still GitHub-preview, after a probe: playwright supports it officially; dev-mode e2e showed sporadic renderer crashes there — cause undiagnosed, and NOT `/dev/shm` (playwright's default switches already carry `--disable-dev-shm-usage`, along with nearly all of puppeteer's CI set — add nothing, and never pass `--disable-features`, which would replace its curated list) — so the CI retry condition treats `crashed` as infrastructure noise; actionlint runs via the kjanat fork until upstream's label DB learns the new runner), `playwright install chromium --only-shell` uncached (restore ≈ download at one browser/one job), retry 0 on unit lanes vs condition-gated retries + `trace: 'retain-on-failure'` + failure-only artifact upload on e2e, and the `github-actions` reporter re-added explicitly (auto-detection dies the moment `reporters` is set). Nightly: shuffled order with `--sequence.seed` pinned to the run id (vitest never prints its own seed), repeats via a job matrix (no `--repeats` flag exists), plus the live Algolia contract.

**Deferred, with triggers:** browser mode (above); coverage thresholds and `.vue` coverage (start with `src/**/*.ts`; template-region mapping has an open cosmetic issue) — ratchet once suites stabilize; `vitest bench` for the TODO §6 benchmarks (bench is exempt from semver and rewritten in v5 — use tinybench directly or wait); `--typecheck`/`expectTypeOf` (tsc/vue-tsc already gate every env, and vitest's typecheck spawns its own tsc that breaks on project references); sharding/blob reports (pays off above roughly 5–8 min per lane; nowhere near).
