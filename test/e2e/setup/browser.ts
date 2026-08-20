import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { inject } from 'vitest'

let browser: Browser | undefined
let context: BrowserContext | undefined
let active: Page | undefined

/** One connection, one context and one page per test file. */
export async function connect(): Promise<void> {
  browser = await chromium.connect(inject('wsEndpoint'))
  context = await browser.newContext({
    // vitest's own browser-mode default is phone-sized; the navbar search
    // button collapses to an icon below 768px.
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  })
  active = await context.newPage()
}

export async function disconnect(): Promise<void> {
  active = undefined
  await context?.close()
  context = undefined
  // Drops this client only; the shared server keeps serving the other files.
  await browser?.close()
  browser = undefined
}

export function page(): Page {
  if (!active) {
    throw new Error('[vp-search e2e] no page — is setup/per-file.ts registered as a setupFile?')
  }
  return active
}

export function url(path: string): string {
  return new URL(path, `${inject('baseUrl')}/`).href
}

export async function goto(path: string): Promise<void> {
  await visit(url(path))
}

/** `goto` for a site other than the shared fixture — the HMR lane runs its own. */
export async function visit(href: string): Promise<void> {
  const target = page()
  await target.goto(href)
  await ready(target)
  await target.evaluate(() => {
    // The dialog restores its last query from sessionStorage, which would leak
    // one test's query into the next on this shared page.
    sessionStorage.clear()
    // `close` does not bubble, so observe it on the way down; `closed()` waits
    // for this rather than for the `open` attribute alone.
    document.addEventListener(
      'close',
      (event) => {
        const target = event.target
        if (target instanceof HTMLDialogElement && target.classList.contains('VPSearchBox')) {
          ;(window as unknown as Record<string, unknown>)['__vpSearchClosed'] = true
        }
      },
      true,
    )
  })
}

/** Resolves once Vue has mounted — SSR markup alone still ignores clicks. */
export async function ready(target: Page = page()): Promise<void> {
  await target.waitForSelector('#app .Layout')
  await target.waitForFunction(() => '__vue_app__' in (document.querySelector('#app') ?? {}))
}
