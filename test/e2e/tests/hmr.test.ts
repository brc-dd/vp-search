import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vitepress'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test } from 'vitest'
import { page, visit } from '../setup/browser.ts'
import { DIALOG, openByClick, options, query, queryEmpty } from '../setup/search.ts'

/**
 * The dev chain DESIGN §11 describes, end to end: an edit reaches `hotUpdate`, which re-indexes
 * that one page, bumps the artifact version and invalidates the manifest, whose `?v=N` URLs send
 * the client past its module cache for a fresh index. A build writes its index once at `buildEnd`,
 * so none of this exists there.
 *
 * On its own server and its own site — see `site-hmr/.vitepress/config.ts` for why an edit to the
 * shared fixture cannot be contained to one test file.
 */
const root = fileURLToPath(new URL('../site-hmr', import.meta.url))
const PAGE = fileURLToPath(new URL('../site-hmr/page.md', import.meta.url))

/** The token the fixture ships with, and the one the edit puts in its place. */
const BEFORE = 'hmrbaseline5501'
const AFTER = 'hmrupdated5502'

let server: Awaited<ReturnType<typeof createServer>> | undefined
let baseUrl = ''
let source: string | undefined

describe.skipIf(inject('buildMode'))('dev re-indexes an edited page', () => {
  beforeAll(async () => {
    server = await createServer(root, { host: '127.0.0.1' })
    await server.listen()
    const local = server.resolvedUrls?.local[0]
    if (!local) throw new Error('[vp-search e2e] the hmr dev server reported no local URL')
    baseUrl = local
    // a cold optimizer run for a site of its own, on top of the shared one
  }, 60_000)

  afterAll(async () => {
    await server?.close()
    server = undefined
  })

  beforeEach(async () => {
    source = await readFile(PAGE, 'utf-8')
    await visit(baseUrl)
  })

  afterEach(async () => {
    // Unconditional: a half-edited fixture would break every later run.
    if (source !== undefined) await writeFile(PAGE, source)
    source = undefined
  })

  test('an edit lands in the index the open client queries', async () => {
    await openByClick()
    // also what guarantees the dev indexer has scanned: until the first search
    // there is no index for `hotUpdate` to keep up to date
    await query(BEFORE, 1)

    await writeFile(PAGE, source!.replace(BEFORE, AFTER))

    // The manifest module accepts no update of its own, so the round trip
    // climbs to the nearest self-accepting importer — the navbar component —
    // and takes the dialog down with it. That unmount is the update landing.
    await page().waitForSelector(DIALOG, { state: 'detached' })

    await openByClick()
    await query(AFTER, 1)
    await expect(options().first().locator('a.result-link').getAttribute('href')).resolves.toBe(
      '/page.html#hmr-page',
    )
    // and the text the edit removed stops answering
    await queryEmpty(BEFORE)
  })
})
