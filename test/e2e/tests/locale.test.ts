import { expect, test } from 'vitest'
import { goto, page } from '../setup/browser.ts'
import {
  input,
  marks,
  openByClick,
  options,
  query,
  queryEmpty,
  waitForAnyOptions,
} from '../setup/search.ts'

test('the language switcher renders for a multi-locale site', async () => {
  await goto('/')
  await expect(page().locator('.VPNavBarTranslations').isVisible()).resolves.toBe(true)
})

test('a CJK query hits the zh index and marks the matched term', async () => {
  await goto('/zh/')
  await openByClick()

  // Word boundaries are implementation-defined per ECMA-402 (DESIGN §13), so
  // assert the invariant — a hit, marked, containing the query — not a count.
  await input().fill('静态')
  await waitForAnyOptions()

  const hits = await marks(0)
  expect(hits.length).toBeGreaterThan(0)
  expect(hits.some((hit) => hit.includes('静态'))).toBe(true)
  await expect(options().first().locator('a.result-link').getAttribute('href')).resolves.toMatch(
    /^\/zh\//,
  )
})

test('an ASCII token in zh content resolves to zh pages only', async () => {
  await goto('/zh/')
  await openByClick()
  await query('zhonlytoken', 2)

  const hrefs = await options()
    .locator('a.result-link')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
  expect(hrefs.every((href) => href.startsWith('/zh/'))).toBe(true)
})

test('root-locale tokens find nothing after switching locale', async () => {
  await goto('/zh/')
  await openByClick()
  // The worker re-inits on the locale change; a stale root index would still
  // answer this and is exactly what the generation counter exists to prevent.
  await queryEmpty('quokkaalpha')
  await expect(options().count()).resolves.toBe(0)
})

test('the root locale still answers after the zh index has been loaded', async () => {
  await goto('/zh/')
  await openByClick()
  await query('zhonlytoken', 2)

  await goto('/')
  await openByClick()
  await query('quokkaalpha', 1)
  await expect(options().first().locator('a.result-link').getAttribute('href')).resolves.toBe(
    '/guide/alpha.html#alpha-guide',
  )
})
