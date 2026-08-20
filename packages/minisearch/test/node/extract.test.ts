import { describe, expect, it } from 'vitest'
import { splitIntoSections, type Section } from '../../src/node/extract.ts'

const split = (
  html: string,
  selector = 'main',
  title = 'Guide',
  fallbackToBody = false,
): Section[] => splitIntoSections(html, selector, title, fallbackToBody)

/** A rendered heading as VitePress emits it, permalink anchor included. */
const heading = (level: number, id: string, text: string): string =>
  `<h${level} id="${id}">${text}<a class="header-anchor" href="#${id}" aria-label="Permalink to &quot;${text}&quot;">​#</a></h${level}>`

describe('heading splitting', () => {
  const html = `<main>
    <p>Intro prose.</p>
    ${heading(2, 'install', 'Install')}
    <p>Run the installer.</p>
    ${heading(3, 'windows', 'Windows')}
    <p>Use the msi.</p>
  </main>`

  it('emits one section per id-bearing heading plus the page-level one', () => {
    expect(split(html).map((section) => section.anchor)).toEqual(['', 'install', 'windows'])
  })

  it('indexes pre-first-heading prose under the page itself', () => {
    const [page] = split(html)
    expect(page).toMatchObject({ anchor: '', title: 'Guide', titles: [], kind: 'page' })
    expect(page?.text).toBe('Intro prose.')
  })

  it('marks heading sections as headings and keeps their own text out of the body', () => {
    const install = split(html)[1]
    expect(install).toMatchObject({ anchor: 'install', title: 'Install', kind: 'heading' })
    expect(install?.text).toBe('Run the installer.')
  })

  it('builds the ancestor breadcrumb from the heading level stack', () => {
    expect(split(html).map((section) => section.titles)).toEqual([[], [], ['Install']])
  })

  it('skips levels without inventing empty ancestors', () => {
    const sections = split(
      `<main>${heading(1, 'top', 'Top')}<p>a</p>${heading(4, 'deep', 'Deep')}<p>b</p></main>`,
    )
    expect(sections.at(-1)?.titles).toEqual(['Top'])
  })

  it('does not split on a heading with no id', () => {
    const sections = split(`<main><h2>Untitled</h2><p>body text</p></main>`)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ anchor: '', kind: 'page' })
    expect(sections[0]?.text).toBe('Untitled body text')
  })

  it('keeps a heading-only section with no body text', () => {
    const sections = split(`<main>${heading(2, 'stub', 'Stub')}</main>`)
    expect(sections).toEqual([
      { anchor: 'stub', title: 'Stub', titles: [], kind: 'heading', text: '' },
    ])
  })

  it('drops a heading with neither title nor text', () => {
    expect(split(`<main><h2 id="blank"></h2></main>`)).toEqual([])
  })
})

describe('heading text', () => {
  it('strips nested markup but keeps its text', () => {
    const sections = split(
      `<main><h2 id="api"><code>createIndexer()</code> API</h2><p>x</p></main>`,
    )
    expect(sections[0]?.title).toBe('createIndexer() API')
  })

  it('drops the permalink anchor and its zero-width space', () => {
    expect(split(`<main>${heading(2, 'install', 'Install')}<p>x</p></main>`)[0]?.title).toBe(
      'Install',
    )
  })

  it('preserves non-ASCII ids as the section anchor', () => {
    const sections = split(`<main>${heading(2, '快速开始', '快速开始')}<p>内容</p></main>`)
    expect(sections[0]).toMatchObject({ anchor: '快速开始', title: '快速开始', text: '内容' })
  })

  it('collapses whitespace inside a multi-line heading', () => {
    const sections = split(`<main><h2 id="multi">Long\n   heading   here</h2><p>x</p></main>`)
    expect(sections[0]?.title).toBe('Long heading here')
  })
})

describe('heading-less pages', () => {
  it('indexes the whole page as one page-level section', () => {
    const sections = split(`<main><p>Only prose here.</p></main>`, 'main', 'Changelog')
    expect(sections).toEqual([
      { anchor: '', title: 'Changelog', titles: [], kind: 'page', text: 'Only prose here.' },
    ])
  })

  it('drops an empty page rather than indexing a title-only shell', () => {
    expect(split(`<main></main>`)).toEqual([])
    expect(split(`<main>   \n\t  </main>`)).toEqual([])
    expect(split(``)).toEqual([])
  })
})

describe('content selector', () => {
  const fragment = `<div class="wrap"><nav>skip me</nav><div class="content"><p>real text</p></div></div>`
  const page = `<!doctype html><html><body>${fragment}</body></html>`

  it('indexes only the selected region', () => {
    expect(split(fragment, '.content')[0]?.text).toBe('real text')
  })

  it('returns nothing when the selector matches nothing', () => {
    expect(split(page, 'main')).toEqual([])
  })

  it('falls back to the body only when asked', () => {
    expect(split(page, 'main', 'Guide', true)[0]?.text).toBe('skip me real text')
  })

  // linkedom only populates `document.body` for a full document; a bare
  // fragment has an empty one. Harmless today — the only `fallbackToBody`
  // caller (src/node/dev.ts) always wraps its HTML in `<main>`.
  it('finds nothing to fall back to in a fragment with no body element', () => {
    expect(split(fragment, 'main', 'Guide', true)).toEqual([])
  })
})

describe('text normalization', () => {
  it('contributes no text from script, style, noscript or template', () => {
    const html = `<main><script>var a = 1</script><style>.a{color:red}</style><noscript>js off</noscript><template><p>tpl</p></template><p>kept</p></main>`
    expect(split(html)[0]?.text).toBe('kept')
  })

  it('separates block elements so their words cannot fuse', () => {
    expect(split(`<main><li>one</li><li>two</li></main>`)[0]?.text).toBe('one two')
  })

  it('keeps inline spans fused, so Shiki code tokens stay one word', () => {
    const html = `<main><pre><code><span>foo</span><span>(</span><span>bar</span></code></pre></main>`
    expect(split(html)[0]?.text).toBe('foo(bar')
  })

  it('collapses whitespace runs and trims the result', () => {
    expect(split(`<main><p>  a \n\n  b  </p></main>`)[0]?.text).toBe('a b')
  })

  it('strips zero-width spaces from body text', () => {
    expect(split(`<main><p>a​b</p></main>`)[0]?.text).toBe('ab')
  })
})
