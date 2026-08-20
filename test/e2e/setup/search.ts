import type { Locator, Page } from 'playwright-core'
import { page } from './browser.ts'

/** Selectors mirror `packages/core/src/client/VPSearchBox.vue` exactly. */
export const TRIGGER = 'button.VPNavBarSearchButton'
export const DIALOG = 'dialog.VPSearchBox'
export const OPEN_DIALOG = `${DIALOG}[open]`
export const INPUT = `${DIALOG} input.search-input`
export const OPTION = `${DIALOG} li.result`
export const GROUP_HEADING = `${DIALOG} .group-heading`
export const EXCERPT = `${DIALOG} .result-excerpt`
export const STATE = `${DIALOG} .state`
export const SPINNER = `${DIALOG} .spinner`
export const STATUS = `${DIALOG} [role="status"]`

export function trigger(target: Page = page()): Locator {
  return target.locator(TRIGGER)
}

export function dialog(target: Page = page()): Locator {
  return target.locator(DIALOG)
}

export function input(target: Page = page()): Locator {
  return target.locator(INPUT)
}

export function options(target: Page = page()): Locator {
  return target.locator(OPTION)
}

/** Clicks the navbar trigger and waits for the lazily-loaded dialog to open. */
export async function openByClick(target: Page = page()): Promise<void> {
  await trigger(target).click()
  await opened(target)
}

export async function openByKey(key: string, target: Page = page()): Promise<void> {
  await target.keyboard.press(key)
  await opened(target)
}

export async function opened(target: Page = page()): Promise<void> {
  await target.waitForSelector(OPEN_DIALOG)
  await target.waitForSelector(INPUT)
  await target.evaluate(() => {
    ;(window as unknown as Record<string, unknown>)['__vpSearchClosed'] = false
  })
}

/**
 * The `open` attribute goes away synchronously but the dialog's `close` event
 * is fired from a queued task. The component now closes synchronously on every
 * path it owns, yet a foreign close still reaches it a task late — so waiting
 * on the attribute alone would let the next interaction slip into that gap.
 */
export async function closed(target: Page = page()): Promise<void> {
  await target.waitForSelector(OPEN_DIALOG, { state: 'detached' })
  await target.waitForFunction(
    () => (window as unknown as Record<string, unknown>)['__vpSearchClosed'] === true,
  )
}

/** Types a query and waits for the debounced run to settle on a row count. */
export async function query(text: string, expected: number, target: Page = page()): Promise<void> {
  await input(target).fill(text)
  await waitForOptions(expected, target)
}

export async function waitForOptions(count: number, target: Page = page()): Promise<void> {
  await target.waitForFunction(
    ([selector, expected]) => document.querySelectorAll(selector!).length === expected,
    [OPTION, count] as [string, number],
  )
}

/** For queries whose hit count depends on `Intl.Segmenter` word boundaries. */
export async function waitForAnyOptions(target: Page = page()): Promise<void> {
  await target.waitForFunction((selector) => document.querySelectorAll(selector).length > 0, OPTION)
}

/** Roving selection lands a flush after the keydown, so poll rather than read. */
export async function waitForActiveDescendant(id: string, target: Page = page()): Promise<void> {
  await target.waitForFunction(
    ([selector, expected]) =>
      document.querySelector(selector!)?.getAttribute('aria-activedescendant') === expected,
    [INPUT, id] as [string, string],
  )
}

/** Waits for the "no results for <text>" state, which only the settled run renders. */
export async function queryEmpty(text: string, target: Page = page()): Promise<void> {
  await input(target).fill(text)
  await target.waitForFunction(
    ([selector, expected]) => document.querySelector(selector!)?.textContent === expected,
    [`${STATE} strong`, text] as [string, string],
  )
}

export async function activeDescendant(target: Page = page()): Promise<string | null> {
  return input(target).getAttribute('aria-activedescendant')
}

/** Ids of the options in display order — the order arrows walk. */
export function optionIds(target: Page = page()): Promise<string[]> {
  return options(target).evaluateAll((nodes) => nodes.map((node) => node.id))
}

export function groupLabels(target: Page = page()): Promise<string[]> {
  return target
    .locator(GROUP_HEADING)
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''))
}

/** Text of every `<mark>` inside one result row. */
export function marks(index: number, target: Page = page()): Promise<string[]> {
  return options(target)
    .nth(index)
    .locator('mark')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''))
}
