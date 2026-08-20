import { describe, expect, it } from 'vitest'
import type { DefaultTheme } from 'vitepress'
import { resolveGroup } from '../../src/node/sidebar.ts'

const GUIDE: DefaultTheme.SidebarItem = {
  text: 'Guide',
  items: [
    { text: 'Getting Started', link: '/guide/getting-started' },
    { text: 'Overview', link: '/guide/' },
  ],
}

const REFERENCE: DefaultTheme.SidebarItem = {
  text: 'Reference',
  items: [
    {
      text: 'CLI',
      items: [{ text: 'Build', link: '/reference/cli/build' }],
    },
  ],
}

describe('array sidebar', () => {
  const sidebar: DefaultTheme.Sidebar = [GUIDE, REFERENCE]

  it('resolves a page to the group whose items contain it', () => {
    expect(resolveGroup(sidebar, 'guide/getting-started.md')).toBe('Guide')
  })

  it('resolves through nested items to the top-level group', () => {
    expect(resolveGroup(sidebar, 'reference/cli/build.md')).toBe('Reference')
  })

  it('matches an index page against a directory link', () => {
    expect(resolveGroup(sidebar, 'guide/index.md')).toBe('Guide')
  })

  it('accepts a path with no leading slash and an .html extension alike', () => {
    expect(resolveGroup(sidebar, '/guide/getting-started.html')).toBe('Guide')
  })

  it('ignores a hash or query on the link', () => {
    const linked: DefaultTheme.Sidebar = [
      { text: 'Guide', items: [{ text: 'Start', link: '/guide/start.md#install' }] },
    ]
    expect(resolveGroup(linked, 'guide/start.md')).toBe('Guide')
  })

  it('returns undefined for a page that is not in the sidebar', () => {
    expect(resolveGroup(sidebar, 'blog/post.md')).toBeUndefined()
  })

  it('does not treat a bare top-level link as a group', () => {
    const flat: DefaultTheme.Sidebar = [{ text: 'Guide', link: '/guide/getting-started' }]
    expect(resolveGroup(flat, 'guide/getting-started.md')).toBeUndefined()
  })
})

describe('multi sidebar', () => {
  const sidebar: DefaultTheme.Sidebar = {
    '/': [{ text: 'Root', items: [{ text: 'Home', link: '/index' }] }],
    '/guide/': [GUIDE],
    '/guide/advanced/': [
      { text: 'Advanced', items: [{ text: 'SSR', link: '/guide/advanced/ssr' }] },
    ],
  }

  it('picks the longest matching path prefix', () => {
    expect(resolveGroup(sidebar, 'guide/advanced/ssr.md')).toBe('Advanced')
  })

  it('falls back to a shorter prefix when the longer one does not match', () => {
    expect(resolveGroup(sidebar, 'guide/getting-started.md')).toBe('Guide')
  })

  it('uses the root key for pages outside every other prefix', () => {
    expect(resolveGroup(sidebar, 'index.md')).toBe('Root')
  })

  it('returns undefined when the matched sidebar has no entry for the page', () => {
    expect(resolveGroup(sidebar, 'guide/missing.md')).toBeUndefined()
  })

  it('applies the multi-sidebar base to relative item links', () => {
    const based: DefaultTheme.Sidebar = {
      '/guide/': {
        base: '/guide/',
        items: [{ text: 'Basics', items: [{ text: 'Intro', link: 'intro' }] }],
      },
    }
    expect(resolveGroup(based, 'guide/intro.md')).toBe('Basics')
  })

  it('leaves external item links alone', () => {
    const external: DefaultTheme.Sidebar = {
      '/guide/': {
        base: '/guide/',
        items: [
          {
            text: 'Links',
            items: [
              { text: 'Vite', link: 'https://vite.dev' },
              { text: 'Intro', link: 'intro' },
            ],
          },
        ],
      },
    }
    expect(resolveGroup(external, 'guide/intro.md')).toBe('Links')
  })
})

describe('labels', () => {
  it('strips HTML from the group label', () => {
    const sidebar: DefaultTheme.Sidebar = [
      {
        text: 'Guide <sup class="beta">beta</sup>',
        items: [{ text: 'Start', link: '/guide/start' }],
      },
    ]
    expect(resolveGroup(sidebar, 'guide/start.md')).toBe('Guide beta')
  })

  it('returns undefined when a label is nothing but markup', () => {
    const sidebar: DefaultTheme.Sidebar = [
      { text: '<span></span>', items: [{ text: 'Start', link: '/guide/start' }] },
    ]
    expect(resolveGroup(sidebar, 'guide/start.md')).toBeUndefined()
  })
})

describe('degenerate input', () => {
  it('returns undefined with no sidebar at all', () => {
    expect(resolveGroup(undefined, 'guide/start.md')).toBeUndefined()
  })

  it('returns undefined for an empty sidebar', () => {
    expect(resolveGroup([], 'guide/start.md')).toBeUndefined()
    expect(resolveGroup({}, 'guide/start.md')).toBeUndefined()
  })
})
