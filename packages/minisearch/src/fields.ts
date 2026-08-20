/**
 * The tier field split, single-sourced. The node indexer builds artifacts from
 * these and the test helpers rebuild them by hand, so drift here is drift in
 * what the tests actually prove. Keep the module dependency-free: the bare-ES
 * shared lane imports it too.
 *
 * The tiers are **monotonic** — everything the titles tier finds stays findable
 * once content supersedes it — so `group` is indexed on both. It was missing
 * from the content set once, which made a sidebar-label query answer from
 * titles and then lose those hits on the upgrade. Neither tier boosts `group`:
 * it takes MiniSearch's implicit 1, the weight it already had on titles.
 *
 * Field order is part of the artifact bytes; callers spread rather than share.
 */

export const TITLES_FIELDS: readonly string[] = ['title', 'titles', 'group']
export const TITLES_STORE_FIELDS: readonly string[] = ['title', 'titles', 'group', 'kind']

/** Content adds body text; configured `extraFields` append after these. */
export const CONTENT_FIELDS: readonly string[] = [...TITLES_FIELDS, 'text']
export const CONTENT_STORE_FIELDS: readonly string[] = [...TITLES_STORE_FIELDS, 'text']
