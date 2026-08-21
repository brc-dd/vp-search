import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import VPNavBarSearch from '../../src/client/VPNavBarSearch.vue'
import { __reset as resetVitepress } from '../../../../test/fixtures/vitepress.ts'

/**
 * The shared adapter fixture exports one frozen adapter with no `preconnect`,
 * and mutating it would leak into every other client test — so this file owns
 * the virtual module instead. The getter keeps `preconnect` settable after the
 * component has already imported it.
 */
const backend = vi.hoisted(() => ({ preconnect: undefined as string[] | undefined }))

vi.mock('virtual:vp-search/adapter', () => ({
  default: {
    name: 'navbar-fixture',
    search: () => ({ results: [] }),
    get preconnect() {
      return backend.preconnect
    },
  },
}))

/** The async dialog chunk is another file's subject; here it is a marker. */
const DIALOG = 'v-p-search-box-stub'

function mountNavBar() {
  return mount(VPNavBarSearch, {
    attachTo: document.body,
    global: { stubs: { VPSearchBox: true } },
  })
}

const wrappers: ReturnType<typeof mountNavBar>[] = []

function mounted() {
  const wrapper = mountNavBar()
  wrappers.push(wrapper)
  return wrapper
}

const dialog = () => document.querySelector(DIALOG)
const links = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"]')]

/** happy-dom ships no `requestIdleCallback`, so the component's `in` check sees this. */
function stubIdleCallback() {
  const idle = vi.fn((callback: () => void) => void callback())
  vi.stubGlobal('requestIdleCallback', idle)
  return idle
}

async function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  await nextTick()
  return event
}

function focused<T extends HTMLElement>(el: T): T {
  document.body.append(el)
  el.focus()
  return el
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  for (const link of links()) link.remove()
  document.body.replaceChildren()
  backend.preconnect = undefined
  vi.useRealTimers()
  resetVitepress()
  // The open path fires defineAsyncComponent's import of VPSearchBox; when this
  // file runs on a cold module graph and finishes first, that chain is still in
  // flight at environment teardown (seed 324460688171 caught it).
  await vi.dynamicImportSettled()
})

describe('preconnect', () => {
  test('injects one idle-time link per origin, credentialled', () => {
    const idle = stubIdleCallback()
    backend.preconnect = ['https://a.example', 'https://b.example']
    mounted()

    expect(idle).toHaveBeenCalledTimes(1)
    expect(links().map((link) => link.getAttribute('href'))).toEqual([
      'https://a.example',
      'https://b.example',
    ])
    // `crossOrigin = ''` is what makes the warmed connection reusable by the
    // adapter's own anonymous fetches
    expect(links().map((link) => link.getAttribute('crossorigin'))).toEqual(['', ''])
    expect(links().map((link) => link.id)).toEqual([
      'vp-search-preconnect-https://a.example',
      'vp-search-preconnect-https://b.example',
    ])
  })

  test('falls back to a timeout where requestIdleCallback is missing (Safari)', () => {
    backend.preconnect = ['https://a.example']
    mounted()
    // deferred either way: the navbar mount must not pay for the link itself
    expect(links()).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(links().map((link) => link.getAttribute('href'))).toEqual(['https://a.example'])
  })

  test('a second navbar adds no second link', () => {
    stubIdleCallback()
    backend.preconnect = ['https://a.example']
    mounted()
    mounted()

    // the id is the dedup key, and it survives the first component entirely
    expect(links()).toHaveLength(1)
  })

  test('an adapter with no origins injects nothing and never waits for idle', () => {
    const idle = stubIdleCallback()
    mounted()
    expect(links()).toHaveLength(0)

    backend.preconnect = []
    mounted()
    expect(links()).toHaveLength(0)
    expect(idle).not.toHaveBeenCalled()
  })
})

describe('hotkeys', () => {
  test('`/` opens the dialog and is consumed', async () => {
    mounted()
    expect(dialog()).toBeNull()

    const event = await press('/')
    expect(dialog()?.getAttribute('open')).toBe('true')
    expect(event.defaultPrevented).toBe(true)
  })

  test.for([
    ['input', () => focused(document.createElement('input'))],
    ['textarea', () => focused(document.createElement('textarea'))],
    [
      'contenteditable',
      () => {
        const el = focused(document.createElement('div'))
        el.setAttribute('contenteditable', 'true')
        return el
      },
    ],
  ] as const)('`/` while editing %s stays in the field', async ([, create]) => {
    mounted()
    const field = create()

    const event = await press('/', {}, field)
    expect(dialog()).toBeNull()
    // not merely ignored: the keystroke has to reach the field as a character
    expect(event.defaultPrevented).toBe(false)
  })

  test('`/` with a modifier belongs to the browser', async () => {
    mounted()

    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      const event = await press('/', { [modifier]: true })
      expect(dialog()).toBeNull()
      expect(event.defaultPrevented).toBe(false)
    }
  })

  test.for(['ctrlKey', 'metaKey'] as const)('%s+k opens the dialog', async (modifier) => {
    mounted()

    const event = await press('k', { [modifier]: true })
    expect(dialog()?.getAttribute('open')).toBe('true')
    expect(event.defaultPrevented).toBe(true)
  })

  test('a bare k is just a letter', async () => {
    mounted()

    const event = await press('k')
    expect(dialog()).toBeNull()
    expect(event.defaultPrevented).toBe(false)
  })

  test('the trigger opens the dialog, and closing it leaves the chunk loaded', async () => {
    const wrapper = mounted()
    await wrapper.get('button.VPNavBarSearchButton').trigger('click')
    expect(dialog()?.getAttribute('open')).toBe('true')

    await wrapper.findComponent({ name: 'VPSearchBox' }).vm.$emit('close')
    await nextTick()
    // still mounted, so a re-open costs no second import
    expect(dialog()?.getAttribute('open')).toBe('false')
  })
})
