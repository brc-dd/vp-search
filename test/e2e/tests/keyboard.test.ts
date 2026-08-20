import { beforeEach, expect, test } from 'vitest'
import { goto, page, ready } from '../setup/browser.ts'
import {
  activeDescendant,
  closed,
  dialog,
  OPEN_DIALOG,
  openByClick,
  openByKey,
  optionIds,
  options,
  query,
  waitForActiveDescendant,
} from '../setup/search.ts'

/** The dialog's scroll lock is pure CSS: `html:has(dialog.VPSearchBox[open])`. */
function rootOverflow(): Promise<string> {
  return page().evaluate(() => getComputedStyle(document.documentElement).overflow)
}

beforeEach(async () => {
  await goto('/')
})

test('`/` opens the dialog and Escape closes it', async () => {
  await openByKey('/')
  await expect(dialog().getAttribute('open')).resolves.not.toBeNull()

  await page().keyboard.press('Escape')
  await closed()
})

test('both Meta+k and Control+k open the dialog', async () => {
  // The component gates on `ctrlKey || metaKey` with no platform branch, so
  // both must work on whichever OS the suite happens to run on.
  await openByKey('Meta+k')
  await page().keyboard.press('Escape')
  await closed()

  await openByKey('Control+k')
  await page().keyboard.press('Escape')
  await closed()
})

// The `close` event fires from a queued task, so a re-open can land while the
// trigger still believes the dialog is open. Closes the box itself owns now
// propagate in the same task, and one it never saw — as here — is re-synced to
// `open` when the event finally arrives.
test('re-opening before the close event lands still opens the dialog', async () => {
  await openByClick()
  await page().evaluate(() => {
    document.querySelector<HTMLDialogElement>('dialog.VPSearchBox')?.close()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
  })
  await page().waitForSelector('dialog.VPSearchBox[open]', { timeout: 1000 })
})

test('Tab never leaves the dialog', async () => {
  await openByClick()
  // a full ring to walk: the input, the clear button and five result links
  await query('sharedtoken', 5)

  // What the native `<dialog>` decision buys instead of a hand-rolled focus
  // trap. At the end of the ring Chromium parks focus on the document itself
  // for one press before wrapping, so that counts as contained — anything
  // else outside (the navbar trigger, a sidebar link) would be a real escape.
  const stops: string[] = []
  for (let step = 0; step < 10; step++) {
    await page().keyboard.press('Tab')
    stops.push(
      await page().evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return 'document'
        if (el.closest('dialog.VPSearchBox')) return 'dialog'
        return `escaped: ${el.tagName}.${el.className}`
      }),
    )
  }

  expect(stops.filter((stop) => stop.startsWith('escaped'))).toEqual([])
  expect(stops.filter((stop) => stop === 'dialog').length).toBeGreaterThan(stops.length / 2)
})

test('`/` typed into a field on the page stays there', async () => {
  await page().evaluate(() => {
    const field = document.createElement('input')
    field.id = 'e2e-field'
    document.body.append(field)
    field.focus()
  })

  await page().keyboard.press('/')
  // the character landing is the proof the keydown was handled, so no dialog
  // can still be on its way
  await expect(page().inputValue('#e2e-field')).resolves.toBe('/')
  await expect(page().locator(OPEN_DIALOG).count()).resolves.toBe(0)
})

test('closing returns focus to the navbar trigger', async () => {
  await openByClick()
  await page().keyboard.press('Escape')
  await closed()

  // Native `<dialog>` focus restoration — the modal must not drop the user
  // back on `<body>`.
  await expect(page().evaluate(() => document.activeElement?.className ?? '')).resolves.toContain(
    'VPNavBarSearchButton',
  )
})

// `show()` pushes a history entry so `popstate` can close the dialog; every
// close that is not itself a `popstate` unwinds it again, or the first Back
// press after Escape would burn the dead entry instead of leaving the page.
test('closing leaves no dead history entry behind', async () => {
  await page().click('.VPSidebar a[href="/guide/alpha.html"]')
  await page().waitForFunction(() => location.pathname === '/guide/alpha.html')

  await openByClick()
  await page().keyboard.press('Escape')
  await closed()

  await page().goBack()
  await ready()
  await expect(page().evaluate(() => location.pathname)).resolves.toBe('/')
})

test('opening locks page scroll and closing restores it', async () => {
  await expect(rootOverflow()).resolves.not.toBe('hidden')

  await openByClick()
  await expect(rootOverflow()).resolves.toBe('hidden')
  // Reserved gutter, so hiding the scrollbar does not shift the layout.
  await expect(
    page().evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter),
  ).resolves.toBe('stable')

  await page().keyboard.press('Escape')
  await closed()
  await expect(rootOverflow()).resolves.not.toBe('hidden')
})

test('arrows move aria-activedescendant and wrap at both ends', async () => {
  await openByClick()
  await query('sharedtoken', 5)

  const ids = await optionIds()
  expect(ids).toHaveLength(5)
  await waitForActiveDescendant(ids[0]!)

  await page().keyboard.press('ArrowDown')
  await waitForActiveDescendant(ids[1]!)
  await expect(options().nth(1).getAttribute('aria-selected')).resolves.toBe('true')
  await expect(options().nth(0).getAttribute('aria-selected')).resolves.toBe('false')

  // Up past the first option wraps to the last…
  await page().keyboard.press('ArrowUp')
  await waitForActiveDescendant(ids[0]!)
  await page().keyboard.press('ArrowUp')
  await waitForActiveDescendant(ids[4]!)

  // …and down past the last wraps back to the first.
  await page().keyboard.press('ArrowDown')
  await waitForActiveDescendant(ids[0]!)
})

test('Home and End jump to the ends of the list', async () => {
  await openByClick()
  await query('sharedtoken', 5)

  const ids = await optionIds()
  await page().keyboard.press('End')
  await waitForActiveDescendant(ids[4]!)
  await page().keyboard.press('Home')
  await waitForActiveDescendant(ids[0]!)
})

test('Enter navigates to the result through the SPA router', async () => {
  await page().evaluate(() => {
    ;(window as unknown as Record<string, unknown>)['__e2eMarker'] = 1
  })

  await openByClick()
  await query('quokkaalpha', 1)
  await expect(activeDescendant()).resolves.not.toBeNull()

  await page().keyboard.press('Enter')
  await page().waitForFunction(() => location.pathname === '/guide/alpha.html')

  await expect(page().evaluate(() => location.hash)).resolves.toBe('#alpha-guide')
  // A full page load would have wiped the marker; the router keeps it.
  await expect(
    page().evaluate(() => (window as unknown as Record<string, unknown>)['__e2eMarker']),
  ).resolves.toBe(1)
  await closed()
})

// Enter replaces the entry `show()` pushed rather than pushing on top of it, so
// the stack reads [origin, destination] and one Back returns to the origin —
// DESIGN §5. Two entries would strand the reader on a dead one.
test('Enter leaves one Back between the destination and where it started', async () => {
  await page().click('.VPSidebar a[href="/guide/alpha.html"]')
  await page().waitForFunction(() => location.pathname === '/guide/alpha.html')

  await openByClick()
  await query('quokkabeta', 1)
  await page().keyboard.press('Enter')
  await page().waitForFunction(() => location.pathname === '/guide/beta.html')
  await closed()

  await page().goBack()
  await ready()
  await expect(page().evaluate(() => location.pathname)).resolves.toBe('/guide/alpha.html')
})
