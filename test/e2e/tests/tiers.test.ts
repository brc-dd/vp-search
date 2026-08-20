import { afterEach, expect, inject, test } from 'vitest'
import { goto, page } from '../setup/browser.ts'
import {
  EXCERPT,
  input,
  openByClick,
  options,
  query,
  queryEmpty,
  SPINNER,
  waitForOptions,
} from '../setup/search.ts'

/**
 * Both artifact shapes at once: dev serves `/@vp-search/<locale>.<tier>.json?v=N`
 * from middleware, a build emits `/vp-search/<locale>.<tier>.<hash>.json`.
 */
const TITLES_ARTIFACT = /\.titles\.[^/]*json/
const CONTENT_ARTIFACT = /\.content\.[^/]*json/

interface Gate {
  release: () => void
  /** Every intercepted URL, in request order. */
  urls: string[]
}

/** Holds every matching request until released, then lets it through. */
async function hold(pattern: RegExp): Promise<Gate> {
  let release!: () => void
  const urls: string[] = []
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page().route(pattern, async (route) => {
    urls.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search)
    await gate
    await route.continue()
  })
  return { release, urls }
}

afterEach(async () => {
  await page().unrouteAll({ behavior: 'ignoreErrors' })
})

test('a query answers from the titles tier, then upgrades when content lands', async () => {
  const { release, urls } = await hold(CONTENT_ARTIFACT)
  try {
    await goto('/')
    await openByClick()

    // The titles tier stores no body text, so a hit arrives without an excerpt.
    await query('zebrasection', 1)
    await expect(options().first().locator('a.result-link').getAttribute('href')).resolves.toBe(
      '/guide/alpha.html#zebrasection-overview',
    )
    await expect(page().locator(EXCERPT).count()).resolves.toBe(0)

    // Proof the interception fired, and that the two modes really do serve
    // different artifacts — a version-busted dev URL vs a hashed static asset.
    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(
      inject('buildMode')
        ? /^\/vp-search\/root\.content\.[0-9a-f]{8}\.json$/
        : /^\/@vp-search\/root\.content\.json\?v=\d+$/,
    )

    release()

    // `onInvalidate` → the client re-runs the live query against the new tier.
    await page().waitForSelector(EXCERPT)
    await waitForOptions(1)
    await expect(options().first().locator('a.result-link').getAttribute('href')).resolves.toBe(
      '/guide/alpha.html#zebrasection-overview',
    )
  } finally {
    release()
  }
})

test('a body-only token is unfindable until the content tier lands', async () => {
  const { release } = await hold(CONTENT_ARTIFACT)
  try {
    await goto('/')
    await openByClick()

    // `buriedmarmot` appears in no title, so the titles tier cannot answer it.
    // Waiting on the settled "no results" state, not on a bare row count, is
    // what keeps this from passing before the debounced query has even run.
    await queryEmpty('buriedmarmot')

    release()
    await waitForOptions(1)
    await expect(page().locator(EXCERPT).textContent()).resolves.toContain('buriedmarmot')
  } finally {
    release()
  }
})

test('a slow index load shows the busy spinner and clears it', async () => {
  const { release } = await hold(TITLES_ARTIFACT)
  try {
    await goto('/')
    await openByClick()
    await input().fill('sharedtoken')

    // `BUSY_DELAY` is 300ms, so the spinner only appears for a genuinely slow load.
    await page().waitForSelector(SPINNER)
    await expect(page().locator('dialog.VPSearchBox ul.result-list.stale').count()).resolves.toBe(1)

    release()
    await waitForOptions(5)
    await page().waitForSelector(SPINNER, { state: 'detached' })
  } finally {
    release()
  }
})
