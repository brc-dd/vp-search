import type { ConsoleMessage } from 'playwright-core'
import { beforeEach, expect, test } from 'vitest'
import { goto, page } from '../setup/browser.ts'
import { closed, input, openByClick, options, query, TRIGGER } from '../setup/search.ts'

beforeEach(async () => {
  await goto('/')
})

test('clicking the backdrop closes the dialog', async () => {
  await openByClick()
  // The shell is centred and inset; the top-left corner is the dialog itself.
  await page().mouse.click(20, 20)
  await closed()
})

test('the clear button empties the query and keeps focus in the input', async () => {
  await openByClick()
  await query('quokkaalpha', 1)

  await page().click('dialog.VPSearchBox button[aria-label="Clear search"]')
  await expect(input().inputValue()).resolves.toBe('')
  await expect(page().evaluate(() => document.activeElement?.className ?? '')).resolves.toContain(
    'search-input',
  )
})

test('clicking a result navigates through the router and closes the dialog', async () => {
  await page().evaluate(() => {
    ;(window as unknown as Record<string, unknown>)['__e2eMarker'] = 1
  })

  await openByClick()
  await query('quokkaalpha', 1)
  // A different path from Enter: the router intercepts the anchor in the
  // capture phase and the dialog only closes once it has.
  await options().first().locator('a.result-link').click()

  await page().waitForFunction(() => location.pathname === '/guide/alpha.html')
  await expect(
    page().evaluate(() => (window as unknown as Record<string, unknown>)['__e2eMarker']),
  ).resolves.toBe(1)
  await closed()
})

test('reopening restores the previous query and its results', async () => {
  await openByClick()
  await query('quokkaalpha', 1)
  await page().keyboard.press('Escape')
  await closed()

  await openByClick()
  await expect(input().inputValue()).resolves.toBe('quokkaalpha')
  await expect(options().count()).resolves.toBe(1)
})

test('a full search flow logs nothing to the console', async () => {
  const noise: string[] = []
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      noise.push(`${message.type()}: ${message.text()}`)
    }
  }
  const onError = (error: Error) => void noise.push(`pageerror: ${error.message}`)

  page().on('console', onConsole)
  page().on('pageerror', onError)
  try {
    await goto('/')
    await openByClick()
    await query('sharedtoken', 5)
    await page().keyboard.press('Enter')
    await page().waitForFunction(() => location.pathname !== '/')
    await closed()
    // Catches hydration mismatches and worker failures, which are warnings
    // rather than test failures everywhere else.
    expect(noise).toEqual([])
  } finally {
    page().off('console', onConsole)
    page().off('pageerror', onError)
  }
})

test('the trigger advertises its shortcuts and the dialog it opens', async () => {
  const trigger = page().locator(TRIGGER)
  await expect(trigger.getAttribute('aria-haspopup')).resolves.toBe('dialog')
  await expect(trigger.getAttribute('aria-keyshortcuts')).resolves.toBe('/ control+k meta+k')
  await expect(trigger.getAttribute('aria-label')).resolves.toBe('Search')
})
