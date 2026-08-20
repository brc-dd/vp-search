# Tasks

Working list for upcoming sessions. Context lives in [DESIGN.md](DESIGN.md); current state: algolia + minisearch providers shipped and browser-verified in `examples/docs`, workspace packages (`@vp-search/core` + `@vp-search/algolia` + `@vp-search/minisearch`) with tsdown builds and publish-ready exports (workspace dev still consumes raw source).

## 1. Meta-plugin split (done 2026-08)

- [x] Restructure to pnpm workspace packages: `packages/core` (UI, shared format, translations, node plugin shell), `packages/algolia` (dep-free), `packages/minisearch` (owns `minisearch` + `linkedom` — moved out of the root package)
- [x] Replace the provider union with the public `ProviderDefinition` / `ProviderApi` contract (DESIGN §8b): `search(minisearch({...}))`, core-owned hook latches, namespaced virtuals, `emitAsset`; the zero-package escape hatch is a bare definition with a `clientModule` file path (`adapterFile` dropped once path resolution was done properly)
- [x] Our adapters consume the same public contract a third party would
- [x] Publish names decided: `@vp-search/*` scope, core as `@vp-search/core`
- [x] Names reserved: `vp-search` npm org claimed; GitHub repo renamed to `brc-dd/vp-search`

## 2. Release readiness

- [x] Build tooling (2026-08): tsdown unbundle builds per package (`tsdown.base.ts`), SFCs stay raw source via vue-sfc-transformer (TS transpiled out, `.d.vue.ts` beside), `.d.ts` for everything; exports stay src for workspace dev, `publishConfig.exports` flips to dist at pack (Nuxt pattern). In-build publint + attw (esm-only, error) + unplugin-unused. No `prepack` scripts — deliberate: attw packs during the build, so a `prepack: tsdown` recurses into a fork bomb; pack/publish flows must run `pnpm build` first
- [ ] Upstream reports from the build-tooling work:
  - vue-sfc-transformer (patched locally in `patches/`, drop when released): oxc transpile drops template-only `.vue`/value imports (tsc-style elision, can't see the template) and synthesizes `export {}` in `<script setup>`; fix = `typescript.onlyRemoveTypeImports` + strip trailing `export {}` (repro: `transform('t.ts', "import V from './V.vue'\nconst x = 1", { lang: 'ts' })` via `rolldown/utils`)
  - pnpm 12 RC: `pnpm pack` writes the pre-POSIX NUL typeflag for regular files (npm and pnpm 11 write `'0'`); breaks minimal tar parsers — @publint/pack 0.1.7 (2026-08-19) already added tolerance on their side, others may not have
  - vitepress 2.0.0-alpha.19: `[Vue warn]: Invalid watch source: Proxy({ open: false })` once per page in vitest-driven SSR builds — `VPSidebar.vue`'s `watch([props, navEl], …)` gets a plain props object under SSR; the CLI build is silent (dev-gated warn). Before filing: not yet isolated in a plugin-free vitest build, so our plugin as a precondition isn't ruled out
- [ ] CSS split into importable layers (`variables` separate from component styles) — unblocked: the build-tooling precondition landed 2026-08
- [x] Separate tsconfigs per environment (2026-08): per-package env projects (core shared/client/node, minisearch shared/client/worker/node, algolia client/node) over `tsconfig.base.json`, run by each package's `typecheck` script in CI; cross-runtime globals for the bare-ES shared projects live in `shared-globals.d.ts` (merge-compatible with lib.dom/@types/node). Caught real leaks on first run (AbortSignal/performance, DOM type names in linkedom-consuming node code, DOM-vs-undici `res.json()`). Tests project still to come with the vitest suites; `examples/docs` deliberately stays at upstream strictness (vendored)
- [x] Vitest suites (2026-08, DESIGN §13): vitest 5.0.0-rc.2, seven projects over per-env test dirs (shared/client/worker/node/integrity/e2e/live), ~700 tests. All scratch seeds ported (incl. the fromTerms marks-slice-the-original-text regression), plus adapter/plugin/provider/indexer/component suites, dist integrity (ex-`validate-sfc` + dist-entry smoke + eager-graph guards), a dedicated-fixture-site e2e (dev + build passes; the fidelity suite pins the dev/prod gap per-mode incl. the `<ClientOnly>` inversion; HMR round trip on an isolated second site) and a live Algolia schema-drift contract lane (`VP_SEARCH_LIVE=1 pnpm test:live`). E2e-over-`examples/docs` was rejected in favor of the dedicated site — vendored content would churn assertions
- [ ] Test-suite follow-ups, deliberately deferred: e2e failure traces (`context.tracing` + `upload-artifact if: failure()`) plus the recorded brittle spots (upstream-owned selectors, fuzzy-sensitive exact counts, scroll-lock CSS coupling, worker-fetch route-interception assumption); coverage thresholds + `.vue` coverage ratchet once suites settle; promote `--detectAsyncLeaks` from nightly to PR CI if it stays quiet; out-of-order worker responses / abort-drop under a real browser (the node shim delivers synchronously; the user-visible consequence is already covered by useSearch's staleness tests — revisit only if a stale-render bug is ever observed); optimizeDeps cold-open waterfall probe (config shape already pinned; a runtime probe is expensive and flaky); `fromRanges` inclusive-end conversion precedent test (defer until a positions-based adapter lands); a fast-check differential oracle was evaluated and REJECTED — it would test MiniSearch's scorer, not our thin wrapper, and adds a dependency for weak assertions
- [ ] Package-specific changelogs + versioning strategy (changesets fits the workspace) + GitHub tags/releases
- [ ] npm trusted publishing (OIDC) setup + first publish
- [ ] `pnpm publish` dry-runs per package (peer ranges, files, exports resolution from dist) — partially covered since 2026-08: every build publint- and attw-checks the packed tarball; packed-tarball consumer smoke (blank vitepress app, build + search in browser) verified by hand, worth scripting
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
- [ ] CI: shipped 2026-08, extended with the test suites (`ci.yml`: parallel check/unit/e2e-matrix lanes — build precedes typecheck because `vue-tsc -p test` validates the dist declarations; integrity tests in check; `--only-shell` chromium, uncached on purpose; TZ/LANG/FORCE_COLOR pinned; lockfile trust-policy verified once per run in check via `PNPM_CONFIG_TRUST_LOCKFILE`; `nightly.yml`: 3× seeded shuffle + `--detectAsyncLeaks` + the live Algolia contract). Still open: publish workflow (OIDC)
- [ ] Repo polishing pass: README rewrite for the split layout, badges, adapter-authoring guide
- [ ] Comment-density cleanup across packages: comments are very verbose today; thin them to the load-bearing ones once APIs are stabler (deferred, like the DESIGN.md distill below)
- [ ] Distill + reorganize DESIGN.md for human readability: keep the format spec, contracts, mapping tables, current architecture, ceilings, and open questions; compress shipped-decision rationale to a line or two (git history keeps the long form); fold survey notes into the sections they justify

## 4. Docs & deployments

- [ ] Actual documentation site for the plugin (usage, migration from core search, provider docs, adapter-authoring guide — dogfoods the plugin itself)
- [ ] Deploy docs (GitHub Pages, maybe)
- [ ] Deploy `examples/docs` separately (maybe) — live demo of both providers
- [ ] Update memory/README pointers when URLs exist

## 5. Features

- [ ] `/search?q=` page (vuejs/vitepress#2983) + OpenSearch descriptor (#2855) — standalone; the navbar trigger stays a dialog button (trigger-as-link rejected, DESIGN §5)
- [ ] Exact/AND + quoted-phrase search (#2731) — feasible now: post-filter the content tier's stored text
- [ ] Warm search on trigger intent: `pointerenter`/`focus` starts the dialog chunk + `adapter.load()` — DESIGN §5
- [ ] Cap rows per result group in the modal (DESIGN §2 derivation rule) — slice in the `groups` computed before the display-order index pass so `data-index`/`aria-activedescendant`/Enter stay contiguous; decide dropped-vs-spilled for capped rows
- [ ] Query persistence as an option, not a hardcoded default (`sessionStorage` key + opt-out via `SearchOptions`, like core) — DESIGN §5
- [ ] Detailed-view toggle (`localStorage`, `aria-pressed` on the control — the one §5 FIX-list item whose control doesn't exist yet) — DESIGN §5
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
- [ ] Worker content-tier progress: §11 once promised progress reporting; the shipped protocol posts only `{ type: 'tier' }` on arrival. Add `{ type: 'progress', loaded, total }` (streamed fetch + Content-Length, determinate UI) or ratify arrival-only — decide before the protocol is public
- [ ] Artifact `v` is written but never read: decide `loadTier`'s behavior for `v !== 1` (named error vs documented forward-tolerance) and pin it in `artifact-compat.test.ts` (a frozen `v: 1` fixture already guards back-compat)
- [ ] Group ordering in the modal: §11 leaves it undecided; today groups follow first appearance in flat backend order (slimsearch exposes `sortStrategy: 'max' | 'total'`). Decide in the parity pass, pin with a client-lane test
- [ ] `<ClientOnly>` content is invisible to production search (measured, e2e fidelity suite; dev's raw-slot path does index it). Document prominently; consider a build-time warning when SSR output loses slot text a component carried

## 7. More providers

- [ ] Pagefind (the >3k-page scale story; no typo tolerance, 52 MB binary as peer dep — DESIGN §11 tradeoffs)
- [ ] Meilisearch / Typesense (mappings specced in DESIGN §4; mechanical)
- [ ] zbsearch — re-checked 2026-08: `zbsearch@4` is now fumadocs-core's default engine; core/stemmers/highlight install clean, but tokenizers + plugin-match-highlight still ship `workspace:*` (offsets path blocked) — re-check when those publish (hedge signal: Fumapress v1, same author, defaulted to FlexSearch instead)
- [ ] `custom` example: paid Algolia with own record schema — needs the promised hit-transform option first (DESIGN §4 row): `toResult` is hard-wired to `DocSearchHit`, so overriding `attributesToRetrieve` alone yields empty-titled results today. Bundle an `attributesToSnippet`/snippet-window option into the same design (it became adapter-owned in the 2026-08 searchParams hardening), and document that `lang` facet values are index conventions, not BCP tags (the vitepress index uses `zh-Hans`, not `zh-CN` — mismatches return zero hits silently)
