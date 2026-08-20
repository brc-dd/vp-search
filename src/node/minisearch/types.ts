/** Everything here crosses node → JSON → worker, so it must stay serializable. */

export interface MinisearchExtraField {
  /** Frontmatter key, indexed and stored under the same name. */
  name: string
  boost?: number
}

export interface MinisearchAdapterOptions {
  /** CSS selector for the indexable region of a rendered page. */
  contentSelector?: string
  /** Frontmatter fields to index alongside the body text. */
  extraFields?: MinisearchExtraField[]
  /** MiniSearch `searchOptions` defaults; data only, no functions. */
  searchOptions?: Record<string, unknown>
}

export type RecordKind = 'page' | 'heading'

export interface IndexRecord {
  /** Site-relative URL with anchor — this is the result's href. */
  id: string
  title: string
  titles: string[]
  text: string
  group?: string
  kind: RecordKind
  [extraField: string]: unknown
}

export type Tier = 'titles' | 'content'

export interface ArtifactOptions {
  fields: string[]
  storeFields: string[]
  searchOptions?: Record<string, unknown>
}

export interface Artifact {
  v: 1
  lang: string
  options: ArtifactOptions
  /** `MiniSearch.toJSON()`, already stringified. */
  index: string
}

/** Tier values are filenames, resolved against the module's `base`. */
export interface ManifestLocale {
  lang: string
  titles: string
  content: string
  sections: number
}

export type Manifest = Record<string, ManifestLocale>

export const OUT_SUBDIR = 'any-search'
export const MANIFEST_NAME = 'manifest.json'
/** Dev artifacts are server-generated, so they get vite's synthetic-path mark. */
export const DEV_SUBDIR = '@any-search'
