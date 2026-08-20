# Tasks

Working list for upcoming sessions. Context lives in [DESIGN.md](DESIGN.md); current state: algolia + minisearch providers shipped and browser-verified in `examples/docs`, split into source-only workspace packages (`@vp-search/core` + `@vp-search/algolia` + `@vp-search/minisearch`).

## 1. Meta-plugin split (done 2026-08)

- [x] Restructure to pnpm workspace packages: `packages/core` (UI, shared format, translations, node plugin shell), `packages/algolia` (dep-free), `packages/minisearch` (owns `minisearch` + `linkedom` — moved out of the root package)
- [x] Replace the provider union with the public `ProviderDefinition` / `ProviderApi` contract (DESIGN §8b): `search(minisearch({...}))`, core-owned hook latches, namespaced virtuals, `emitAsset`; `adapterFile` escape hatch kept
- [x] Our adapters consume the same public contract a third party would
- [x] Publish names decided: `@vp-search/*` scope, core as `@vp-search/core`
- [x] Names reserved: `vp-search` npm org claimed; GitHub repo renamed to `brc-dd/vp-search`

## 2. Release readiness

- [ ] Build tooling: everything ships as raw TS/SFC today (type-stripping + consumer Vite); needs real builds (tsdown or similar), dist-pointing exports maps, `.d.ts`, SFCs stay raw source per DESIGN §8
- [ ] CSS split into importable layers (`variables` separate from component styles)
- [ ] Separate tsconfigs per environment — client (DOM + Vue), node (node types, no DOM lib), shared core (neither, keeping the format/helpers environment-free) and tests — so environment leaks fail typecheck (DOM access in node code, node imports in shared); falls out naturally with per-package tsconfigs/project references in the split, and CI runs each project's typecheck alongside the tests
- [ ] Move verification harnesses into in-repo vitest suites (worker core fixtures, highlight helpers, useSearch incl. onInvalidate, indexer splitter/determinism) + an e2e over `examples/docs` — seeds preserved in the untracked local `scratch/` dir (all four run green via `node scratch/<name>.ts`); include a marks-slice-the-original-text case for `fromTerms` (slimsearch regression: it marks the raw query string, so display casing is lost)
- [ ] Package-specific changelogs + versioning strategy (changesets fits the workspace) + GitHub tags/releases
- [ ] npm trusted publishing (OIDC) setup + first publish
- [ ] `pnpm publish` dry-runs per package (peer ranges, files, exports resolution from dist)
- [ ] Pre-ship sweep of modern platform features across CSS/HTML/JS/TS/Node/ESM for progressive improvements — including features beyond the Baseline 2024 floor, adopted behind feature detection / graceful degradation rather than raising the floor. Candidates parked so far, with why:
  - CSS Custom Highlight API — main path needs no DOM post-processing (segments render real `<mark>`s from data); only the tool for the future rendered-HTML excerpt view, and Baseline 2025 (Firefox 140). DESIGN §5.
  - `<search>` element — surfaced in the Baseline pass but unapplied: shell semantics need an a11y review against the dialog + combobox pattern first
  - `@scope` — Vue scoped styles already isolate the SFC; only interesting for the global scroll-lock rule
  - dialog `closedby` / invoker commands — would delete the manual backdrop hit-test and open/close wiring, but Baseline 2025
  - view transitions on modal open — `@starting-style` transitions already cover it cheaply; VT is beyond the floor and needs its own reduced-motion care
  - `content-visibility` on result lists — pointless at 12 rows; becomes relevant for the `/search` page's long lists
  - `scheduler.yield` in the worker — queries measured sub-ms at docs scale, only matters for giant-corpus tiers; Chromium-only
  - `Promise.withResolvers` — Baseline 2024, adoptable now: the minisearch adapter hand-rolls a `Deferred`; trivial refactor left for the sweep
  - iterator helpers — late-2024/2025 baseline edge; minor indexer wins at best
  - import attributes — no JSON-module need yet (node side reads via fs); vitepress core just adopted them (b0da3845), so use for consistency when the need appears
  - `import.meta.resolve` — already adopted (node plugin alias resolution, with a `new URL` fallback); listed as done, not pending

## 3. Repo & governance

- [ ] LICENSE file (package.json says MIT; no file exists) — per package after the split
- [ ] GitHub UI fields: description, topics, website; social preview
- [ ] Policies: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue/PR templates
- [ ] CI: typecheck + tests + example build on PR; publish workflow (OIDC)
- [ ] Repo polishing pass: README rewrite for the split layout, badges, adapter-authoring guide

## 4. Docs & deployments

- [ ] Actual documentation site for the plugin (usage, migration from core search, provider docs, adapter-authoring guide — dogfoods the plugin itself)
- [ ] Deploy docs (GitHub Pages, maybe)
- [ ] Deploy `examples/docs` separately (maybe) — live demo of both providers
- [ ] Update memory/README pointers when URLs exist

## 5. Features

- [ ] `/search?q=` page (vuejs/vitepress#2983) + OpenSearch descriptor (#2855); once it exists the navbar trigger becomes a real `<a>` to it that JS intercepts (Ogygia pattern, DESIGN §5)
- [ ] Exact/AND + quoted-phrase search (#2731) — feasible now: post-filter the content tier's stored text
- [ ] Warm search on trigger intent: `pointerenter`/`focus` starts the dialog chunk + `adapter.load()` — DESIGN §5
- [ ] Cap rows per result group in the modal (DESIGN §2 derivation rule)
- [ ] Attribution/logo mechanism (DESIGN §12.3): free DocSearch requires the SVG logo; field vs shipped fragments undecided
- [ ] Wire per-locale translations in `examples/docs` (locale configs still carry inert DocSearch translation blocks to migrate)
- [ ] URL rewrite hook placement (component `getRelativePath` today vs adapter/`transformResult`) — DESIGN §12.2
- [ ] Upstream `provider: 'custom'` / search slot in vitepress core to retire the alias hijack — or the VuePress-style global-component seam, likely the smallest diff — DESIGN §7/§12.1
- [ ] Upstream: better markdown renderer export (vuejs/vitepress#2410, brc-dd's comment) — singleton `renderMd(md)` with a `$frontmatter` fast path replacing `createMarkdownRenderer`; Node-side only, usable inside hooks/loaders, rejects before vitepress is up; fixes #5162-class frontmatter interpolation. Then migrate the minisearch dev indexer off `createMarkdownRenderer` onto it (shrinks the dev-mode fidelity gap and drops our private-renderer construction)
- [ ] Idle-state content: curated quick-links option first (Fumadocs `links`), then recent searches / favorites (DocSearch parity; slimsearch UX notes in DESIGN §5; never scoped)

## 6. Minisearch provider

- [ ] Benchmarks for the new local search: index size / query latency / memory vs core local search and Pagefind, on the docs corpus and a synthetic large site (research baselines are in DESIGN §11 and session notes); include the record-interning size experiment and the title-rerank check (DESIGN §11, 2026-08 notes)
- [ ] Parity validation pass: run the same corpus through core local search and our minisearch provider and compare indexed-section coverage, search-option defaults, and top results; plus cross-adapter consistency checks (algolia vs minisearch: group labels, URL shapes, kinds) — automate over `examples/docs`
- [ ] `layout: home` pages index zero records (`contentSelector: 'main'`; parity with core) — document or add fallback
- [ ] Build-time `Intl.Segmenter` assertion (small-ICU Node builds segment CJK differently than browsers)
- [ ] IndexedDB artifact caching (measured 4 ms warm-open in research)
- [ ] Mark-coverage check at build time (term-based marking can miss on aggressive normalization)
- [ ] Dev-mode fidelity gap (markdown-renderer path lacks vite transforms/dynamic routes; components index as raw slot text where prod indexes rendered output) — documented; improve if cheap
- [ ] Decide on `raw` in worker results (omitted for postMessage weight — worker deviation to ratify)

## 7. More providers

- [ ] Pagefind (the >3k-page scale story; no typo tolerance, 52 MB binary as peer dep — DESIGN §11 tradeoffs)
- [ ] Meilisearch / Typesense (mappings specced in DESIGN §4; mechanical)
- [ ] zbsearch — re-checked 2026-08: `zbsearch@4` is now fumadocs-core's default engine; core/stemmers/highlight install clean, but tokenizers + plugin-match-highlight still ship `workspace:*` (offsets path blocked) — re-check when those publish (hedge signal: Fumapress v1, same author, defaulted to FlexSearch instead)
- [ ] `custom` example: paid Algolia with own record schema (hit-transform option)
