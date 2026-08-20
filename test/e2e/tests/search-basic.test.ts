import { beforeEach, expect, test } from 'vitest'
import { goto, page } from '../setup/browser.ts'
import {
  activeDescendant,
  dialog,
  EXCERPT,
  groupLabels,
  input,
  marks,
  openByClick,
  options,
  query,
  queryEmpty,
  STATE,
  STATUS,
  trigger,
} from '../setup/search.ts'

beforeEach(async () => {
  await goto('/')
})

test('the navbar trigger opens the dialog and hands it real focus', async () => {
  await expect(trigger().isVisible()).resolves.toBe(true)
  await expect(dialog().count()).resolves.toBe(0)

  await openByClick()

  await expect(dialog().getAttribute('aria-label')).resolves.toBe('Search')
  // `document.activeElement`, not just an `:focus-visible` style.
  const focused = await page().evaluate(() => document.activeElement?.id ?? null)
  await expect(input().getAttribute('id')).resolves.toBe(focused)
  await expect(page().locator(STATE).textContent()).resolves.toContain('Type to search')
})

test('a query renders a marked result row for the matching section', async () => {
  await openByClick()
  await query('quokkaalpha', 1)

  const row = options().first()
  await expect(row.locator('.result-title').textContent()).resolves.toBe('Alpha Guide')
  await expect(row.locator('a.result-link').getAttribute('href')).resolves.toBe(
    '/guide/alpha.html#alpha-guide',
  )
  // A real <mark> element rendered from segments, not a highlighted string.
  await expect(marks(0)).resolves.toEqual(['quokkaalpha'])
  await expect(
    row
      .locator(':scope mark')
      .first()
      .evaluate((node) => node.tagName),
  ).resolves.toBe('MARK')
})

test('results group under the sidebar section they belong to', async () => {
  await openByClick()
  await query('sharedtoken', 5)

  // `group` comes from the fixture sidebar, resolved at index time.
  await expect(groupLabels()).resolves.toEqual(expect.arrayContaining(['Guide', 'Reference']))
  await expect(page().locator(STATUS).textContent()).resolves.toBe('5 results for sharedtoken')
})

test('a token buried mid-paragraph produces a windowed excerpt', async () => {
  await openByClick()
  await query('buriedmarmot', 1)

  const excerpt = await page().locator(EXCERPT).textContent()
  expect(excerpt).toContain('buriedmarmot')
  // Elided at both cuts: the match sits far from either end of the paragraph.
  expect(excerpt?.startsWith('…')).toBe(true)
  expect(excerpt?.endsWith('…')).toBe(true)
  await expect(marks(0)).resolves.toEqual(['buriedmarmot'])
})

test('a heading-less page indexes under its own page URL', async () => {
  await openByClick()
  await query('quokkabare', 1)

  const row = options().first()
  await expect(row.locator('a.result-link').getAttribute('href')).resolves.toBe('/bare.html')
  await expect(row.locator('.result-title').textContent()).resolves.toBe('Bare Page')
  await expect(row.locator('.result-crumbs').count()).resolves.toBe(0)
})

test('prose before the first heading indexes under the page URL', async () => {
  await openByClick()
  await query('preludetoken', 1)

  await expect(options().first().locator('a.result-link').getAttribute('href')).resolves.toBe(
    '/guide/beta.html',
  )
})

test('`search: false` keeps a page out of every result', async () => {
  await openByClick()
  await queryEmpty('hiddentoken')

  await expect(options().count()).resolves.toBe(0)
  await expect(page().locator(STATE).textContent()).resolves.toContain('No results for')
  await expect(page().locator(STATUS).textContent()).resolves.toBe('No results for hiddentoken')
  // Nothing is selectable, so the combobox points at no option.
  await expect(activeDescendant()).resolves.toBeNull()
})
