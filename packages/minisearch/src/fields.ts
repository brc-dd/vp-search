/**
 * Tier field lists, single-sourced — the indexer builds artifacts from these and test helpers
 * rebuild them by hand, so drift here is drift in what tests prove. Dependency-free: the bare-ES
 * shared lane imports it too.
 */

export const TITLES_FIELDS: readonly string[] = ['title', 'titles', 'group']
export const TITLES_STORE_FIELDS: readonly string[] = ['title', 'titles', 'group', 'kind']

/**
 * Content adds body text; configured `extraFields` append after these. Tiers are monotonic —
 * everything titles finds must stay findable once content supersedes it — so `group` must stay in
 * both lists, and field order is part of the artifact bytes.
 */
export const CONTENT_FIELDS: readonly string[] = [...TITLES_FIELDS, 'text']
export const CONTENT_STORE_FIELDS: readonly string[] = [...TITLES_STORE_FIELDS, 'text']
