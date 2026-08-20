import MiniSearch from 'minisearch'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { resolveSiteDataByRoute, type DefaultTheme, type SiteConfig } from 'vitepress'
import {
  CONTENT_FIELDS,
  CONTENT_STORE_FIELDS,
  TITLES_FIELDS,
  TITLES_STORE_FIELDS,
} from '../fields.ts'
import { createTokenizer } from '../tokenize.ts'
import { splitIntoSections } from './extract.ts'
import { resolveGroup } from './sidebar.ts'
import {
  MANIFEST_NAME,
  type Artifact,
  type IndexRecord,
  type Manifest,
  type ManifestLocale,
  type MinisearchProviderOptions,
  type Tier,
} from './types.ts'

export interface PageInput {
  /** Relative to `srcDir`, rewrites applied — the route, not the source file. */
  relativePath: string
  /** Relative to `srcDir`, as authored; resolves colocated additional configs. */
  filePath: string
  title: string
  frontmatter: Record<string, unknown>
  html: string
}

/** Writes one build asset; the provider passes `ProviderApi.emitAsset`. */
export type EmitAsset = (fileName: string, source: string) => Promise<void>

export interface Indexer {
  index(page: PageInput, fallbackToBody?: boolean): void
  remove(relativePath: string): void
  locales(): string[]
  lang(locale: string): string
  sections(locale: string): number
  artifact(locale: string, tier: Tier): string
  write(emit: EmitAsset): Promise<Manifest>
}

interface PageEntry {
  locale: string
  records: IndexRecord[]
}

export function createIndexer(
  siteConfig: SiteConfig<DefaultTheme.Config>,
  options: MinisearchProviderOptions,
): Indexer {
  const contentSelector = options.contentSelector ?? 'main'
  const extraFields = options.extraFields ?? []
  const extraNames = extraFields.map((field) => field.name)
  const searchOptions = mergeSearchOptions(options)

  const byPage = new Map<string, PageEntry>()
  const langs = new Map<string, string>()
  const cache = new Map<string, string>()

  function index(page: PageInput, fallbackToBody = false): void {
    cache.clear()
    // Frontmatter is only known after render, so this check lives here rather
    // than in a page filter.
    if (page.frontmatter['search'] === false) return void byPage.delete(page.relativePath)

    const siteData = resolveSiteDataByRoute(siteConfig.site, page.relativePath, page.filePath)
    const locale = siteData.localeIndex ?? 'root'
    langs.set(locale, siteData.lang)

    const url = docId(siteConfig, page.relativePath)
    const group = resolveGroup(
      (siteData.themeConfig as DefaultTheme.Config | undefined)?.sidebar,
      page.relativePath,
    )
    const extras = pickExtras(page.frontmatter, extraNames)
    const sections = splitIntoSections(page.html, contentSelector, page.title, fallbackToBody)

    const records = sections.map((section): IndexRecord => {
      const record: IndexRecord = {
        id: section.anchor ? `${url}#${section.anchor}` : url,
        title: section.title,
        titles: section.titles,
        text: section.text,
        kind: section.kind,
        ...extras,
      }
      if (group) record.group = group
      return record
    })

    if (records.length) byPage.set(page.relativePath, { locale, records })
    else byPage.delete(page.relativePath)
  }

  function remove(relativePath: string): void {
    cache.clear()
    byPage.delete(relativePath)
  }

  function locales(): string[] {
    const known = Object.keys(siteConfig.site.locales ?? {})
    const seen = new Set(known.length ? known : ['root'])
    for (const { locale } of byPage.values()) seen.add(locale)
    return [...seen].sort(compare)
  }

  function recordsFor(locale: string): IndexRecord[] {
    const records: IndexRecord[] = []
    for (const entry of byPage.values()) {
      if (entry.locale === locale) records.push(...entry.records)
    }
    // Insertion order decides MiniSearch's internal ids and its serialized
    // radix-tree layout; sorting is what makes artifacts byte-reproducible.
    return records.sort((a, b) => compare(a.id, b.id))
  }

  function langFor(locale: string): string {
    return langs.get(locale) ?? siteConfig.site.locales?.[locale]?.lang ?? siteConfig.site.lang
  }

  function artifact(locale: string, tier: Tier): string {
    const key = `${locale}.${tier}`
    const cached = cache.get(key)
    if (cached) return cached

    const lang = langFor(locale)
    const fields = tier === 'titles' ? [...TITLES_FIELDS] : [...CONTENT_FIELDS, ...extraNames]
    const storeFields =
      tier === 'titles' ? [...TITLES_STORE_FIELDS] : [...CONTENT_STORE_FIELDS, ...extraNames]

    const mini = new MiniSearch<IndexRecord>({
      idField: 'id',
      fields,
      storeFields,
      tokenize: createTokenizer(lang),
    })

    const seen = new Set<string>()
    for (const record of recordsFor(locale)) {
      // Duplicate heading ids on one page would otherwise abort the build.
      if (seen.has(record.id)) continue
      seen.add(record.id)
      mini.add(record)
    }

    const payload: Artifact = {
      v: 1,
      lang,
      options: { fields, storeFields, ...(searchOptions && { searchOptions }) },
      index: JSON.stringify(mini),
    }
    const json = JSON.stringify(payload)
    cache.set(key, json)
    return json
  }

  async function write(emit: EmitAsset): Promise<Manifest> {
    const manifest: Manifest = {}
    for (const locale of locales()) {
      const entry: Partial<ManifestLocale> = {
        lang: langFor(locale),
        sections: recordsFor(locale).length,
      }
      for (const tier of ['titles', 'content'] as const) {
        const json = artifact(locale, tier)
        const name = `${locale}.${tier}.${hash(json)}.json`
        await emit(name, json)
        entry[tier] = name
      }
      manifest[locale] = entry as ManifestLocale
    }

    // Hashed tiers are immutable; the manifest is the one file that must not
    // be cached across deploys.
    await emit(MANIFEST_NAME, JSON.stringify(manifest))
    return manifest
  }

  return {
    index,
    remove,
    locales,
    lang: langFor,
    sections: (locale) => recordsFor(locale).length,
    artifact,
    write,
  }
}

/** Byte-identical output for identical content means no locale-aware compare. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8)
}

/** The final href, exactly as core bakes it into local-search ids. */
export function docId(siteConfig: SiteConfig, relativePath: string): string {
  let id = slash(path.join(siteConfig.site.base, relativePath))
  id = id.replace(/(^|\/)index\.md$/, '$1')
  return id.replace(/\.md$/, siteConfig.cleanUrls ? '' : '.html')
}

export function slash(p: string): string {
  return p.replace(/\\/g, '/')
}

function pickExtras(frontmatter: Record<string, unknown>, names: string[]): Record<string, string> {
  const extras: Record<string, string> = {}
  for (const name of names) {
    const value = frontmatter[name]
    const text = Array.isArray(value)
      ? value.filter((item) => item != null && typeof item !== 'object').join(' ')
      : value == null || typeof value === 'object'
        ? ''
        : String(value)
    if (text) extras[name] = text
  }
  return extras
}

function mergeSearchOptions(
  options: MinisearchProviderOptions,
): Record<string, unknown> | undefined {
  const boost: Record<string, unknown> = {}
  for (const field of options.extraFields ?? []) {
    if (field.boost != null) boost[field.name] = field.boost
  }
  const userBoost = options.searchOptions?.['boost']
  if (userBoost && typeof userBoost === 'object') Object.assign(boost, userBoost)

  const merged = { ...options.searchOptions }
  if (Object.keys(boost).length) merged['boost'] = boost
  return Object.keys(merged).length ? merged : undefined
}
