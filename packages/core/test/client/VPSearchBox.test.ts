import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import { expectConsole } from '../../../../test/setup/console.ts'
import type { SearchAdapter } from '../../src/adapter.ts'
import VPSearchBox from '../../src/client/VPSearchBox.vue'
import type { SearchResponse } from '../../src/types.ts'
import fixtureAdapter, {
  __invalidate,
  __reset as resetAdapter,
  __setDocs,
  __setError,
} from '../../../../test/fixtures/adapter.ts'
import { __reset as resetOptions, __setOptions } from '../../../../test/fixtures/options.ts'
import {
  __navigations,
  __reset as resetVitepress,
  __setLocale,
  __setSite,
} from '../../../../test/fixtures/vitepress.ts'

const QUERY_KEY = 'vp-search:query'
/** The component's own constant: how long `busy` must hold before the spinner. */
const BUSY_DELAY = 300

function get<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`missing element: ${selector}`)
  return el
}

const find = (selector: string) => document.querySelector<HTMLElement>(selector)
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const input = () => get<HTMLInputElement>('input.search-input')
const options = () => all('li.result')
const selectedId = () => find('[aria-selected="true"]')?.id
const activeDescendant = () => input().getAttribute('aria-activedescendant')

function mountBox(props: { adapter?: SearchAdapter; open?: boolean } = {}) {
  return mount(VPSearchBox, {
    props: { adapter: fixtureAdapter, open: true, ...props },
    attachTo: document.body,
  })
}

let wrapper: ReturnType<typeof mountBox> | null = null

/** `show()` restores the query, then focuses on the next flush. */
async function opened(props: Parameters<typeof mountBox>[0] = {}) {
  wrapper = mountBox(props)
  await nextTick()
  return wrapper
}

async function type(value: string, ms = 250) {
  const el = input()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

async function press(key: string, init: KeyboardEventInit = {}, target?: Element) {
  const el = target ?? input()
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  await nextTick()
}

async function click(el: Element, type_ = 'click') {
  el.dispatchEvent(new MouseEvent(type_, { bubbles: true, cancelable: true }))
  await nextTick()
}

function deferredAdapter() {
  let resolve!: (value: SearchResponse) => void
  const gate = new Promise<SearchResponse>((res) => (resolve = res))
  const search = vi.fn(() => gate)
  return { adapter: { name: 'slow', search } satisfies SearchAdapter, resolve, search }
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
  document.documentElement.className = ''
  document.documentElement.scrollTop = 0
  resetAdapter()
  resetOptions()
  resetVitepress()
})

describe('open and close', () => {
  test('opens the dialog when the prop flips, and focuses the input', async () => {
    await opened({ open: false })
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(false)

    await wrapper?.setProps({ open: true })
    await nextTick()
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(true)
    expect(document.activeElement).toBe(input())
  })

  test('opens on mount when it mounts already open', async () => {
    await opened()
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(true)
  })

  test('closing the dialog emits close', async () => {
    await opened()
    await wrapper?.setProps({ open: false })
    await nextTick()

    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(false)
    expect(wrapper?.emitted('close')).toHaveLength(1)
  })

  test('the close button closes the dialog', async () => {
    await opened()
    await click(get('.close-button'))

    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(false)
    expect(wrapper?.emitted('close')).toHaveLength(1)
  })

  test('a click on the backdrop closes, a click inside does not', async () => {
    await opened()
    await click(get('.shell'))
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(true)

    await click(get('dialog.VPSearchBox'))
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(false)
  })

  test('Escape reaches it as cancel, and closes in that same task', async () => {
    // the real fix for the close/re-open race: `close` would land a task later
    await opened()
    get('dialog.VPSearchBox').dispatchEvent(new Event('cancel', { cancelable: true }))

    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(false)
    expect(wrapper?.emitted('close')).toHaveLength(1)
  })

  test('the back button (popstate) closes it, without unwinding again', async () => {
    const back = vi.spyOn(history, 'back')
    await opened()
    window.dispatchEvent(new Event('popstate'))
    await nextTick()

    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(false)
    expect(wrapper?.emitted('close')).toHaveLength(1)
    // that popstate *was* the entry being popped
    expect(back).not.toHaveBeenCalled()
  })

  test('any other close unwinds the entry it pushed', async () => {
    const push = vi.spyOn(history, 'pushState')
    const back = vi.spyOn(history, 'back')
    await opened()
    expect(push).toHaveBeenCalledTimes(1)

    await click(get('.close-button'))
    expect(back).toHaveBeenCalledTimes(1)

    // and the next open pushes a fresh one
    await wrapper?.setProps({ open: false })
    await wrapper?.setProps({ open: true })
    await nextTick()
    expect(push).toHaveBeenCalledTimes(2)
  })

  test('the entry it pushes leaves the scroll position on the one below', async () => {
    // the router restores `scrollPosition` when that entry comes back, so
    // unwinding after a close must not drop the reader at the top of the page
    history.replaceState({ marker: 'origin' }, '')
    document.documentElement.scrollTop = 240
    const replace = vi.spyOn(history, 'replaceState')
    const push = vi.spyOn(history, 'pushState')

    await opened()

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith({ marker: 'origin', scrollPosition: 240 }, '')
    // ours is pushed on top of it, so the scroll must be written first
    expect(replace.mock.invocationCallOrder[0]!).toBeLessThan(push.mock.invocationCallOrder[0]!)
    expect(push).toHaveBeenCalledWith(null, '', null)
  })

  test('a close it never saw is re-synced to the open prop', async () => {
    // `dialog.close()` from elsewhere: the event lands a task late, so by then a
    // re-open may have been swallowed — the prop is the intent, and it wins
    await opened()
    get<HTMLDialogElement>('dialog.VPSearchBox').close()
    await nextTick()

    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(true)
    expect(wrapper?.emitted('close')).toBeUndefined()
  })

  test('unmounting takes the teleported dialog with it', async () => {
    await opened()
    wrapper?.unmount()
    wrapper = null

    expect(find('dialog.VPSearchBox')).toBeNull()
  })
})

describe('results', () => {
  test('groups rows by page when the backend sends no group', async () => {
    await opened()
    await type('the')

    expect(all('.group-heading').map((el) => text(el))).toEqual(['Guide', 'API'])
    expect(options()).toHaveLength(3)
    // display order drives the ids, so keyboard/aria/Enter all agree
    expect(options().map((el) => el.dataset['index'])).toEqual(['0', '1', '2'])
  })

  test('groups by the group field when the backend sends one', async () => {
    __setDocs([
      { url: '/a.html#one', title: 'One', group: 'Guides', text: 'alpha' },
      { url: '/c.html', title: 'Three', group: 'Reference', text: 'alpha' },
      { url: '/b.html#two', title: 'Two', group: 'Guides', text: 'alpha' },
    ])
    await opened()
    await type('alpha')

    expect(all('.group-heading').map((el) => text(el))).toEqual(['Guides', 'Reference'])
    // grouping reorders: the third doc joins the first group
    expect(all('.group-items').map((ul) => ul.querySelectorAll('li').length)).toEqual([2, 1])
    expect(options().map((el) => text(el.querySelector('.result-title')))).toEqual([
      'One',
      'Two',
      'Three',
    ])
  })

  test('renders marks from MarkedText, keeping the display casing of the source', async () => {
    await opened()
    await type('install')

    const title = get('.result-title')
    expect(title.querySelectorAll('mark')).toHaveLength(1)
    expect(text(title.querySelector('mark'))).toBe('Install')
    expect(text(get('.result-excerpt mark'))).toBe('Install')
  })

  test('renders crumbs, hrefs and the composed option label', async () => {
    await opened()
    await type('plugin')

    const first = options()[0]
    expect(text(first?.querySelector('.result-crumbs') ?? null)).toBe('Guide')
    expect(first?.querySelector('a')?.getAttribute('href')).toBe('/guide.html#install')
    expect(first?.getAttribute('aria-label')).toBe('Guide, Install, Install the plugin.')
  })

  test('honours cleanUrls when building hrefs', async () => {
    __setSite({ cleanUrls: true })
    await opened()
    await type('plugin')

    expect(options()[0]?.querySelector('a')?.getAttribute('href')).toBe('/guide#install')
  })

  test('picks an icon per result kind', async () => {
    __setDocs([
      { url: '/a.html', title: 'A', text: 'alpha' },
      { url: '/b.html', title: 'B', text: 'alpha', kind: 'heading' },
      { url: '/c.html', title: 'C', text: 'alpha', kind: 'content' },
    ])
    await opened()
    await type('alpha')

    // no per-kind class ships, so the path count is what distinguishes them
    expect(options().map((el) => el.querySelectorAll('.result-icon path').length)).toEqual([
      2, 4, 3,
    ])
  })

  test('re-runs the query when the adapter invalidates', async () => {
    await opened()
    await type('plugin')
    expect(options()).toHaveLength(2)

    __setDocs([{ url: '/late.html', title: 'Late', text: 'plugin, richer tier' }])
    __invalidate()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()

    expect(options()).toHaveLength(1)
    expect(text(get('.result-title'))).toBe('Late')
  })
})

describe('row keys', () => {
  test('id-less rows key by url, so a re-query patches the row it keeps', async () => {
    // MiniSearch results carry no `id` at all, which makes `url` the shipping
    // path rather than a fallback
    __setDocs([
      { url: '/a.html#one', title: 'One', text: 'alpha beta' },
      { url: '/a.html#two', title: 'Two', text: 'beta' },
    ])
    await opened()
    await type('beta')

    const rows = options()
    expect(rows).toHaveLength(2)
    expect(rows.map((el) => el.querySelector('a')?.getAttribute('href'))).toEqual([
      '/a.html#one',
      '/a.html#two',
    ])

    // narrowing to the second doc alone: keyed by url the survivor keeps its
    // element, keyed by position it would inherit the first row's
    await type('two')
    expect(options()).toHaveLength(1)
    expect(options()[0]).toBe(rows[1])
  })

  test('an explicit id outranks the url', async () => {
    const keyed: SearchAdapter = {
      name: 'keyed',
      search: (query) => ({
        results: [
          {
            id: 'stable',
            url: query === 'one' ? '/a.html#one' : '/a.html#two',
            title: [{ text: 'Section' }],
            group: 'Guide',
          },
        ],
      }),
    }
    await opened({ adapter: keyed })
    await type('one')
    const row = options()[0]

    await type('two')
    // the url moved and the key did not, so the row is patched, not replaced
    expect(options()[0]).toBe(row)
    expect(options()[0]?.querySelector('a')?.getAttribute('href')).toBe('/a.html#two')
  })
})

describe('keyboard navigation', () => {
  test('ArrowDown and ArrowUp move the active option and wrap at both ends', async () => {
    await opened()
    await type('the')
    const ids = options().map((el) => el.id)
    expect(selectedId()).toBe(ids[0])

    await press('ArrowDown')
    expect(selectedId()).toBe(ids[1])
    await press('ArrowDown')
    expect(selectedId()).toBe(ids[2])
    await press('ArrowDown')
    expect(selectedId()).toBe(ids[0])

    await press('ArrowUp')
    expect(selectedId()).toBe(ids[2])
  })

  test('aria-activedescendant follows the selection', async () => {
    await opened()
    await type('the')
    expect(activeDescendant()).toBe(selectedId())

    await press('ArrowDown')
    expect(activeDescendant()).toBe(selectedId())
    expect(activeDescendant()).toBe(options()[1]?.id)
  })

  test('Home and End jump to the ends', async () => {
    await opened()
    await type('the')

    await press('End')
    expect(selectedId()).toBe(options()[2]?.id)
    await press('Home')
    expect(selectedId()).toBe(options()[0]?.id)
  })

  test('navigation keys are consumed, so the caret does not move', async () => {
    await opened()
    await type('the')
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    input().dispatchEvent(event)
    await nextTick()

    expect(event.defaultPrevented).toBe(true)
  })

  test('Ctrl+N/P move only when the theme marks the platform as mac', async () => {
    await opened()
    await type('the')
    const ids = options().map((el) => el.id)

    await press('n', { ctrlKey: true })
    expect(selectedId()).toBe(ids[0])

    document.documentElement.classList.add('mac')
    await press('n', { ctrlKey: true })
    expect(selectedId()).toBe(ids[1])
    await press('p', { ctrlKey: true })
    expect(selectedId()).toBe(ids[0])

    // any other modifier disqualifies it
    await press('n', { ctrlKey: true, shiftKey: true })
    expect(selectedId()).toBe(ids[0])
  })

  test('arrow keys do nothing while there are no results', async () => {
    await opened()
    await press('ArrowDown')
    expect(activeDescendant()).toBeNull()
    expect(options()).toHaveLength(0)
  })
})

describe('selecting a result', () => {
  test('Enter routes to the selected row and closes', async () => {
    await opened()
    await type('the')
    await press('ArrowDown')

    await press('Enter')
    expect(__navigations).toEqual(['/guide.html#usage'])
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(false)
    expect(wrapper?.emitted('close')).toHaveLength(1)
  })

  test('Enter mid-composition does not navigate (IME guard)', async () => {
    await opened()
    await type('the')

    await press('Enter', { isComposing: true })
    expect(__navigations).toEqual([])
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(true)
  })

  test('Enter on a button activates the button instead of routing', async () => {
    await opened()
    await type('the')

    await press('Enter', {}, get('.close-button'))
    expect(__navigations).toEqual([])
  })

  test('Enter with no results does nothing', async () => {
    await opened()
    await press('Enter')

    expect(__navigations).toEqual([])
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(true)
  })

  test('a click the router already handled closes the dialog', async () => {
    await opened()
    await type('the')
    const link = get('.result-link')

    // undefaulted click: the router ignored it (new tab, download), stay open
    await click(link)
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(true)

    const handled = new MouseEvent('click', { bubbles: true, cancelable: true })
    handled.preventDefault()
    link.dispatchEvent(handled)
    await nextTick()
    expect(get<HTMLDialogElement>('dialog.VPSearchBox').open).toBe(false)
  })

  test('the first pointer move takes selection back from the keyboard', async () => {
    await opened()
    await type('the')
    await press('ArrowDown')
    const rows = options()

    await click(rows[2] as Element, 'mousemove')
    expect(selectedId()).toBe(rows[2]?.id)

    // hover arbitration is on now, so mouseenter alone moves the selection
    await click(rows[0] as Element, 'mouseenter')
    expect(selectedId()).toBe(rows[0]?.id)
  })
})

describe('states', () => {
  test('idle before anything is typed', async () => {
    await opened()

    expect(text(get('.state'))).toBe('Type to search the documentation')
    expect(options()).toHaveLength(0)
    expect(input().getAttribute('aria-expanded')).toBe('false')
    expect(activeDescendant()).toBeNull()
  })

  test('empty names the query that found nothing', async () => {
    await opened()
    await type('  zzzznope  ')

    expect(text(get('.state'))).toBe('No results for zzzznope')
    expect(text(get('.state strong'))).toBe('zzzznope')
    expect(input().getAttribute('aria-expanded')).toBe('false')
  })

  test('pending renders no state text at all, just a busy list', async () => {
    const { adapter } = deferredAdapter()
    await opened({ adapter })
    await type('plugin')

    expect(find('.state')).toBeNull()
    expect(find('.state-error')).toBeNull()
    expect(get('.result-list').getAttribute('aria-busy')).toBe('true')
  })

  test('the spinner waits out BUSY_DELAY, then dims the stale list', async () => {
    const { adapter, resolve } = deferredAdapter()
    await opened({ adapter })
    await type('plugin')
    expect(find('.spinner')).toBeNull()

    await vi.advanceTimersByTimeAsync(BUSY_DELAY)
    await nextTick()
    expect(find('.spinner')).not.toBeNull()
    expect(get('.result-list').classList.contains('stale')).toBe(true)
    // the spinner takes the clear button's slot while it shows
    expect(find('.search-actions .icon-button')).toBeNull()

    resolve({ results: [], total: { count: 0, exact: true } })
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    expect(find('.spinner')).toBeNull()
    expect(get('.result-list').classList.contains('stale')).toBe(false)
  })

  test('error takes over the surface and drops the previous hits', async () => {
    // the component logs every error it renders
    const errorLog = expectConsole('error', '[vp-search]')
    await opened()
    await type('plugin')
    expect(options()).toHaveLength(2)

    __setError(new Error('backend down'))
    await type('plugin two')

    const state = get('.state-error')
    expect(state.getAttribute('role')).toBe('alert')
    expect(text(state.querySelector('p'))).toBe('Search is unavailable right now.')
    expect(text(get('.retry-button'))).toBe('Try again')
    expect(options()).toHaveLength(0)
    expect(errorLog).toHaveBeenCalledWith('[vp-search]', expect.any(Error))
  })

  test('retry re-runs the query and restores the results', async () => {
    expectConsole('error', '[vp-search]')
    __setError(new Error('backend down'))
    await opened()
    await type('plugin')
    expect(find('.state-error')).not.toBeNull()

    __setError(undefined)
    await click(get('.retry-button'))
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()

    expect(find('.state-error')).toBeNull()
    expect(options()).toHaveLength(2)
    expect(document.activeElement).toBe(input())
  })
})

describe('announcements', () => {
  test('counts results for the live region', async () => {
    await opened()
    const live = get('[role="status"]')
    expect(live.getAttribute('aria-live')).toBe('polite')

    await type('the')
    expect(text(live)).toBe('3 results for the')

    await type('install')
    expect(text(live)).toBe('1 result for install')

    await type('zzzznope')
    expect(text(live)).toBe('No results for zzzznope')
  })
})

describe('aria wiring', () => {
  test('the input is the combobox and owns the listbox', async () => {
    await opened()
    const el = input()

    expect(el.getAttribute('role')).toBe('combobox')
    expect(el.getAttribute('aria-autocomplete')).toBe('list')
    expect(el.getAttribute('aria-controls')).toBe(get('.result-list').id)
    expect(get('.result-list').getAttribute('role')).toBe('listbox')
    expect(get('.result-list').getAttribute('aria-label')).toBe('Search results')
    expect(get('dialog.VPSearchBox').getAttribute('aria-label')).toBe('Search')
  })

  test('aria-expanded tracks whether there is anything to expand', async () => {
    await opened()
    expect(input().getAttribute('aria-expanded')).toBe('false')

    await type('plugin')
    expect(input().getAttribute('aria-expanded')).toBe('true')

    await type('zzzznope')
    expect(input().getAttribute('aria-expanded')).toBe('false')
  })

  test('group headings are hidden from AT but name their own group', async () => {
    await opened()
    await type('the')

    const heading = get('.group-heading')
    expect(heading.getAttribute('aria-hidden')).toBe('true')
    expect(get('.group-items').getAttribute('aria-labelledby')).toBe(heading.id)
    expect(get('.group').getAttribute('role')).toBe('presentation')
    expect(options()[0]?.getAttribute('role')).toBe('option')
  })
})

describe('translations', () => {
  test('a locale switch changes what the modal renders', async () => {
    await opened()
    await type('zzzznope')
    expect(text(get('.state'))).toBe('No results for zzzznope')

    __setLocale('zh', 'zh-CN')
    await nextTick()
    expect(text(get('.state'))).toBe('无法找到相关结果 zzzznope')
    // the zh fixture translates only part of the modal
    expect(get('dialog.VPSearchBox').getAttribute('aria-label')).toBe('Search')
  })

  test('root options override the built-in defaults', async () => {
    __setOptions({ translations: { modal: { idleText: 'Start typing…', title: 'Find' } } })
    await opened()

    expect(text(get('.state'))).toBe('Start typing…')
    expect(get('dialog.VPSearchBox').getAttribute('aria-label')).toBe('Find')
    expect(get('.close-button').getAttribute('aria-label')).toBe('Close search')
  })

  test('the footer keys reach the shortcut hints', async () => {
    await opened()

    expect(all('.shortcut').map((el) => text(el))).toEqual([
      'to navigate',
      'to select',
      'esc to close',
    ])
    expect(all('.shortcut kbd').map((el) => el.getAttribute('aria-label'))).toEqual([
      'up arrow',
      'down arrow',
      'enter',
      'escape',
    ])
  })
})

describe('query box', () => {
  test('persists the query and restores it on the next open', async () => {
    await opened()
    await type('plugin')
    expect(sessionStorage.getItem(QUERY_KEY)).toBe('plugin')

    wrapper?.unmount()
    wrapper = null
    await opened()
    expect(input().value).toBe('plugin')

    await vi.advanceTimersByTimeAsync(250)
    await nextTick()
    expect(options()).toHaveLength(2)
  })

  test('the clear button appears with a query and empties it', async () => {
    await opened()
    expect(find('.search-actions .icon-button')).toBeNull()

    await type('plugin')
    const clear = get('.search-actions .icon-button')
    expect(clear.getAttribute('aria-label')).toBe('Clear search')

    await click(clear)
    await vi.advanceTimersByTimeAsync(250)
    await nextTick()
    expect(input().value).toBe('')
    expect(options()).toHaveLength(0)
    expect(text(get('.state'))).toBe('Type to search the documentation')
    expect(document.activeElement).toBe(input())
  })

  test('the input is capped and opts out of the mobile keyboard helpers', async () => {
    await opened()
    const el = input()

    expect(el.getAttribute('maxlength')).toBe('64')
    expect(el.getAttribute('autocomplete')).toBe('off')
    expect(el.getAttribute('autocorrect')).toBe('off')
    expect(el.getAttribute('autocapitalize')).toBe('off')
    expect(el.getAttribute('spellcheck')).toBe('false')
    expect(el.getAttribute('enterkeyhint')).toBe('go')
  })
})

describe('attribution', () => {
  test('links the backend when it offers a URL', async () => {
    await opened()
    const link = get<HTMLAnchorElement>('a.attribution')

    expect(text(link)).toBe('Search by Fixture')
    expect(link.getAttribute('href')).toBe('https://example.com')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  })

  test('renders plain text when there is no URL, and nothing at all without attribution', async () => {
    const bare: SearchAdapter = {
      name: 'bare',
      attribution: { label: 'Bare' },
      search: () => ({ results: [] }),
    }
    await opened({ adapter: bare })
    expect(find('a.attribution')).toBeNull()
    expect(text(get('span.attribution'))).toBe('Search by Bare')

    wrapper?.unmount()
    wrapper = null
    await opened({ adapter: { name: 'none', search: () => ({ results: [] }) } })
    expect(find('.attribution')).toBeNull()
  })
})
