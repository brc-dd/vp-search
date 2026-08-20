import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import { h } from 'vue'
import VPMarkedText from '../../src/client/VPMarkedText.vue'
import type { MarkedText } from '../../src/types.ts'

/** The component's root is a fragment, so render it inside a host element. */
function render(text: MarkedText) {
  const wrapper = mount({ render: () => h('div', { class: 'host' }, [h(VPMarkedText, { text })]) })
  return wrapper.get('.host').element
}

/** Vue anchors each fragment with an empty text node; those are not content. */
function content(host: Element): [number, string][] {
  return [...host.childNodes]
    .filter((node) => node.nodeType !== Node.COMMENT_NODE && node.textContent !== '')
    .map((node) => [node.nodeType, node.textContent ?? ''])
}

describe('VPMarkedText', () => {
  test('renders unmarked segments as text nodes and marked ones as <mark> elements', () => {
    const host = render([{ text: 'foo' }, { text: 'bar', mark: true }, { text: 'baz' }])

    expect(content(host)).toEqual([
      [Node.TEXT_NODE, 'foo'],
      [Node.ELEMENT_NODE, 'bar'],
      [Node.TEXT_NODE, 'baz'],
    ])
    expect(host.querySelectorAll('mark')).toHaveLength(1)
    expect(host.textContent).toBe('foobarbaz')
  })

  test('mark: false renders as text, like an absent flag', () => {
    const host = render([{ text: 'foo', mark: false }])

    expect(host.querySelectorAll('mark')).toHaveLength(0)
    expect(host.textContent).toBe('foo')
  })

  test('renders one <mark> per segment — merging is the highlight helpers job', () => {
    const host = render([
      { text: 'a', mark: true },
      { text: 'b', mark: true },
    ])

    expect(host.querySelectorAll('mark')).toHaveLength(2)
    expect(host.textContent).toBe('ab')
  })

  test('segment text containing markup renders as text, never as HTML', () => {
    const host = render([
      { text: '<b>hi</b>' },
      { text: '<img src=x onerror="alert(1)">', mark: true },
    ])

    expect(host.querySelector('b')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('<b>hi</b><img src=x onerror="alert(1)">')
    expect(host.innerHTML).toContain('&lt;b&gt;hi&lt;/b&gt;')
  })

  test('an empty MarkedText renders nothing', () => {
    const host = render([])

    expect(content(host)).toEqual([])
    expect(host.textContent).toBe('')
  })
})
