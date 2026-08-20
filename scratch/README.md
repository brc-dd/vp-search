# scratch

Session-era verification harnesses preserved as seeds for the future vitest
suites (see TODO §2). Each runs standalone: `node scratch/<name>.ts`.

- `minisearch-fixture.ts` — worker core: loadTier/runSearch/excerpt windowing, tiers, CJK, boosts (33 assertions)
- `worker-protocol.ts` — worker shell: tier ordering, re-init races, 404s, dispose (17 assertions)
- `invalidate-check.ts` — useSearch re-runs the active query on adapter onInvalidate
- `merge-check.ts` — contiguous-mark merging in fromRanges/fromTagged
