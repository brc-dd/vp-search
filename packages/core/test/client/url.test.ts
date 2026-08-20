import { describe, expect, test } from 'vitest'
import { getRelativePath } from '../../src/client/url.ts'

describe('getRelativePath', () => {
  test('reduces an absolute crawler URL to a site-relative path', () => {
    expect(getRelativePath('https://example.com/guide.html')).toBe('/guide.html')
    expect(getRelativePath('https://example.com/')).toBe('/')
  })

  test('keeps the anchor, which the URL fuses into the result', () => {
    expect(getRelativePath('https://example.com/guide.html#install')).toBe('/guide.html#install')
    expect(getRelativePath('/guide.html#install')).toBe('/guide.html#install')
  })

  test('drops the query string', () => {
    expect(getRelativePath('https://example.com/guide.html?highlight=x#install')).toBe(
      '/guide.html#install',
    )
  })

  test('strips .html when the site uses cleanUrls', () => {
    expect(getRelativePath('/guide.html', true)).toBe('/guide')
    expect(getRelativePath('/guide.html#install', true)).toBe('/guide#install')
  })

  test('keeps .html when the site does not', () => {
    expect(getRelativePath('/guide.html', false)).toBe('/guide.html')
    expect(getRelativePath('/guide.html')).toBe('/guide.html')
  })

  test('leaves an already-relative path alone, base segments included', () => {
    expect(getRelativePath('/docs/guide.html#a')).toBe('/docs/guide.html#a')
    expect(getRelativePath('guide.html')).toBe('/guide.html')
    expect(getRelativePath('https://example.com/docs/guide.html')).toBe('/docs/guide.html')
  })

  test('only a trailing .html is stripped', () => {
    expect(getRelativePath('/a.html.md', true)).toBe('/a.html.md')
    expect(getRelativePath('/guide/', true)).toBe('/guide/')
    expect(getRelativePath('/guide/', false)).toBe('/guide/')
  })
})
