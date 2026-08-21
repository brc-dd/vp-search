# Tasks

Working list for upcoming sessions. Context lives in [DESIGN.md](DESIGN.md); current state: algolia + minisearch providers shipped and browser-verified in `examples/docs`, workspace packages (`@vp-search/core` + `@vp-search/algolia` + `@vp-search/minisearch`) with tsdown builds and publish-ready exports (workspace dev still consumes raw source).

## 1. Meta-plugin split (done 2026-08)

pnpm workspace under the `@vp-search/*` scope: `core` (UI, shared format, node plugin), `algolia` (dep-free), `minisearch` (owns `minisearch` + `linkedom`). Providers plug in through the public `ProviderDefinition`/`ProviderApi` contract (DESIGN §8b) — our own adapters use the same seam a third party would, and a bare definition with a `clientModule` path works without any package. npm org and GitHub name (`brc-dd/vp-search`) reserved.

## 2. Release readiness

Done 2026-08 (details in DESIGN §8/§13 and git history):

- Build tooling: tsdown unbundle builds, SFCs ship as raw source (vue-sfc-transformer), `publishConfig.exports` flips src→dist at pack, in-build publint + attw + unplugin-unused. Never add `prepack` scripts — attw packs during the build, so `prepack: tsdown` is a fork bomb; run `pnpm build` before pack/publish.
- Per-environment tsconfig projects (client/node/shared/worker per package): environment leaks fail `pnpm typecheck`.
- Vitest suites (DESIGN §13): vitest 5 rc, seven projects (shared/client/worker/node/integrity/e2e/live), ~700 tests — unit, component, provider/plugin, dist-integrity, a dedicated-fixture-site e2e in dev and build modes (incl. the dev/prod indexing-fidelity contract and an HMR round trip), and a live Algolia schema-drift lane (`pnpm test:live`; nightly in CI).

Pending:

- [ ] File upstream reports:
  - vue-sfc-transformer — oxc's TS transpile drops imports used only in the template (tsc-style elision can't see templates) and synthesizes a trailing `export {}` in `<script setup>`; worked around in `patches/` via `typescript.onlyRemoveTypeImports` + stripping the synthesized export — drop the patch when a fixed release lands
  - pnpm 12 — `pnpm pack` writes the pre-POSIX NUL typeflag for regular files (npm and pnpm 11 write `'0'`), which breaks minimal tar parsers; @publint/pack already added tolerance on their side, other consumers may not have
- [ ] CSS split into importable layers (`variables` vs component styles)
- [ ] Test follow-ups:
  - e2e failure artifacts — capture playwright traces on failure and upload them from CI; today a red e2e run leaves no visual evidence
  - harden the known-brittle e2e assertions: theme-owned selectors, exact result counts (sensitive to MiniSearch's fuzzy/prefix settings), scroll-lock asserted through the CSS `:has()` rule, and the tiers test's assumption that `page.route` can intercept worker fetches
  - coverage: add `.vue` files and ratchet thresholds once the suites settle (v8 over src `.ts` only today, nothing gates)
  - `--detectAsyncLeaks` runs in the nightly — promote it to PR CI if it stays quiet
  - `fromRanges` inclusive-end conversion precedent test — deferred until a positions-based adapter exists to need it
  - evaluated and rejected, kept so they don't get re-proposed: a fast-check differential oracle (would test MiniSearch's scorer, not our thin wrapper), a runtime optimizeDeps waterfall probe (expensive and flaky; the config shape is already pinned), a real-browser out-of-order worker race (stale-response handling is covered in unit tests; revisit only if a stale render is ever observed)
- [ ] Changelogs + versioning (changesets) + GitHub releases
- [ ] npm trusted publishing (OIDC) + first publish
- [ ] Before publishing, hand-check the packed-tarball consumer smoke once (blank vitepress app: install the tarballs, build, search works)
- [ ] Pre-ship sweep of modern platform features — beyond-Baseline ones go behind feature detection rather than raising the floor. Parked candidates:
  - CSS Custom Highlight API — only needed for a future rendered-HTML excerpt view; segments already render real `<mark>`s
  - `<search>` element — wants an a11y review against the dialog + combobox pattern first
  - `@scope` — Vue scoped styles already isolate the SFCs; only the global scroll-lock rule would benefit
  - dialog `closedby` / invoker commands — would delete the manual backdrop hit-test and close wiring, but Baseline 2025
  - view transitions on modal open — `@starting-style` already covers it cheaply; needs its own reduced-motion care
  - `content-visibility` on result lists — pointless at 12 rows; relevant once the `/search` page has long lists
  - `scheduler.yield` in the worker — queries are sub-ms at docs scale; giant corpora only, and Chromium-only
  - `Promise.withResolvers` — adoptable now: replaces the minisearch adapter's hand-rolled Deferred
  - iterator helpers — minor indexer wins at best
  - import attributes — adopt when a JSON-module need appears (vitepress core already uses them)
  - `import.meta.resolve` — already adopted in the node plugin; done, not pending

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
