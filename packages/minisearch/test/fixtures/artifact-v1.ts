/**
 * A frozen `v: 1` artifact pair — the back-compat early warning.
 *
 * `artifact-v1.titles.json` / `artifact-v1.content.json` were emitted by the real `createIndexer`
 * at commit 7e95bae (MiniSearch 7.2.x, `serializationVersion: 2`) and are **never regenerated**: a
 * change to the artifact format, the field split, the record shape or the tokenizer that would
 * strand indexes already deployed on readers' sites shows up here as a failing test rather than as
 * a silent miss in production.
 *
 * Corpus — one locale (`root`, `lang: 'en-US'`, `base: '/'`, `cleanUrls: false`), five records over
 * three pages, with a two-section sidebar (`Guide` → `/guide/`, `/guide/i18n`; `Reference` →
 * `/reference/cli`) so `group` is populated:
 *
 * | id                     | title                | group     | kind    |
 * | ---------------------- | -------------------- | --------- | ------- |
 * | `/guide/`              | Getting Started      | Guide     | page    |
 * | `/guide/#install`      | Install              | Guide     | heading |
 * | `/guide/i18n.html`     | Internationalization | Guide     | page    |
 * | `/guide/i18n.html#cjk` | CJK                  | Guide     | heading |
 * | `/reference/cli.html`  | Command Line         | Reference | page    |
 *
 * `/guide/i18n.html#cjk` carries Chinese body text, so the pair also pins the `Intl.Segmenter` half
 * of the contract. Its terms are frozen at the ICU that indexed them, so queries against it must
 * hold under a _different_ ICU at query time — see the note in `artifact-compat.test.ts`.
 *
 * To regenerate deliberately (a format bump, not a fix): index the corpus above through
 * `createIndexer` and overwrite both files in one commit, with the reason in the message.
 */

import { readFileSync } from 'node:fs'
import type { Artifact, Tier } from '../../src/types.ts'

/** Locale key and lang the pair was emitted under. */
export const FIXTURE_LANG = 'en-US'

export const FIXTURE_IDS = [
  '/guide/',
  '/guide/#install',
  '/guide/i18n.html',
  '/guide/i18n.html#cjk',
  '/reference/cli.html',
]

/** A fresh parse per call, so a test mutating an artifact can't leak. */
export function frozenArtifact(tier: Tier): Artifact {
  const url = new URL(`./artifact-v1.${tier}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as Artifact
}
