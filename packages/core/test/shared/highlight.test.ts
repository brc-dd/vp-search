import { describe, expect, test } from 'vitest'
import {
  fromRanges,
  fromTagged,
  fromTerms,
  plain,
  textOf,
  unescapeEntities,
  type HighlightRange,
} from '../../src/highlight.ts'

/** The sentinel tags the Algolia adapter asks the backend for. */
const PRE = '\u0002'
const POST = '\u0003'

describe('plain / textOf', () => {
  test('plain wraps text in one unmarked segment, and drops the empty string', () => {
    expect(plain('hello')).toEqual([{ text: 'hello' }])
    expect(plain('')).toEqual([])
  })

  test('textOf concatenates every segment, marked or not', () => {
    expect(textOf([{ text: 'foo' }, { text: 'bar', mark: true }, { text: 'baz' }])).toBe(
      'foobarbaz',
    )
    expect(textOf(plain('round trip'))).toBe('round trip')
    expect(textOf([])).toBe('')
  })
})

describe('fromTagged', () => {
  test('splits multi-character tags into marked and unmarked runs', () => {
    expect(fromTagged('the <em>quick</em> fox', '<em>', '</em>')).toEqual([
      { text: 'the ' },
      { text: 'quick', mark: true },
      { text: ' fox' },
    ])
  })

  test('a mark at the very start emits no leading empty segment', () => {
    expect(fromTagged(`${PRE}quick${POST} fox`, PRE, POST)).toEqual([
      { text: 'quick', mark: true },
      { text: ' fox' },
    ])
  })

  test('adjacent marked runs merge into one segment', () => {
    expect(fromTagged(`${PRE}快速${POST}${PRE}开始${POST} now`, PRE, POST)).toEqual([
      { text: '快速开始', mark: true },
      { text: ' now' },
    ])
    expect(fromTagged('<b>a</b><b>b</b><b>c</b>', '<b>', '</b>')).toEqual([
      { text: 'abc', mark: true },
    ])
  })

  test('gapped marked runs stay separate', () => {
    expect(fromTagged(`pre ${PRE}one${POST} mid ${PRE}two${POST}`, PRE, POST)).toEqual([
      { text: 'pre ' },
      { text: 'one', mark: true },
      { text: ' mid ' },
      { text: 'two', mark: true },
    ])
  })

  test('an empty marked run emits no segment, and does not split the text around it', () => {
    expect(fromTagged(`a${PRE}${POST}b`, PRE, POST)).toEqual([{ text: 'ab' }])
  })

  test('a dangling pre tag marks the rest of the value', () => {
    expect(fromTagged(`a${PRE}bc`, PRE, POST)).toEqual([{ text: 'a' }, { text: 'bc', mark: true }])
    // dangling after a mark that ends where it starts: merged, still one run
    expect(fromTagged(`${PRE}a${POST}${PRE}b`, PRE, POST)).toEqual([{ text: 'ab', mark: true }])
  })

  test('a post tag with no pre tag is stripped, never rendered', () => {
    // sentinel tags are control characters; they must not reach display text
    expect(fromTagged(`a${POST}b`, PRE, POST)).toEqual([{ text: 'ab' }])
    expect(fromTagged(`${POST}${PRE}a${POST}${POST}`, PRE, POST)).toEqual([
      { text: 'a', mark: true },
    ])
  })

  test('an empty value yields no segments', () => {
    expect(fromTagged('', PRE, POST)).toEqual([])
  })

  test('tags and text made of regex metacharacters are matched literally', () => {
    expect(fromTagged('x(y)z', '(', ')')).toEqual([
      { text: 'x' },
      { text: 'y', mark: true },
      { text: 'z' },
    ])
    const value = `.*+?[](){}|^$\\ ${PRE}c$1${POST}`
    expect(fromTagged(value, PRE, POST)).toEqual([
      { text: '.*+?[](){}|^$\\ ' },
      { text: 'c$1', mark: true },
    ])
  })
})

describe('fromRanges', () => {
  test('end is exclusive', () => {
    expect(fromRanges('hello', [{ start: 0, end: 2 }])).toEqual([
      { text: 'he', mark: true },
      { text: 'llo' },
    ])
  })

  test('unsorted input is sorted, and the caller array is not mutated', () => {
    const ranges: HighlightRange[] = [
      { start: 6, end: 8 },
      { start: 0, end: 2 },
    ]
    expect(fromRanges('ab cd ef', ranges)).toEqual([
      { text: 'ab', mark: true },
      { text: ' cd ' },
      { text: 'ef', mark: true },
    ])
    expect(ranges[0]).toEqual({ start: 6, end: 8 })
  })

  test('adjacent ranges merge into one marked segment', () => {
    expect(
      fromRanges('快速开始 now', [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([{ text: '快速开始', mark: true }, { text: ' now' }])
  })

  test('overlapping ranges clamp and merge', () => {
    expect(
      fromRanges('abcdef', [
        { start: 0, end: 3 },
        { start: 2, end: 5 },
      ]),
    ).toEqual([{ text: 'abcde', mark: true }, { text: 'f' }])
    // a range fully contained in the previous one adds nothing
    expect(
      fromRanges('abcdef', [
        { start: 0, end: 4 },
        { start: 1, end: 3 },
      ]),
    ).toEqual([{ text: 'abcd', mark: true }, { text: 'ef' }])
  })

  test('gapped ranges stay separate', () => {
    expect(
      fromRanges('a bc d', [
        { start: 0, end: 1 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([
      { text: 'a', mark: true },
      { text: ' ' },
      { text: 'bc', mark: true },
      { text: ' d' },
    ])
  })

  test('out-of-bounds ranges clamp, and empty or inverted ones are dropped', () => {
    expect(fromRanges('abc', [{ start: 1, end: 99 }])).toEqual([
      { text: 'a' },
      { text: 'bc', mark: true },
    ])
    expect(fromRanges('abc', [{ start: -5, end: 2 }])).toEqual([
      { text: 'ab', mark: true },
      { text: 'c' },
    ])
    expect(fromRanges('abc', [{ start: 10, end: 20 }])).toEqual([{ text: 'abc' }])
    expect(fromRanges('abc', [{ start: 2, end: 2 }])).toEqual([{ text: 'abc' }])
    expect(fromRanges('abc', [{ start: 3, end: 1 }])).toEqual([{ text: 'abc' }])
  })

  test('an empty ranges array returns the text unmarked', () => {
    expect(fromRanges('abc', [])).toEqual([{ text: 'abc' }])
    expect(fromRanges('', [])).toEqual([])
    expect(fromRanges('', [{ start: 0, end: 4 }])).toEqual([])
  })

  test('offsets count characters, not UTF-8 bytes', () => {
    const text = '日本語のドキュメント'
    const out = fromRanges(text, [{ start: 0, end: 3 }])
    expect(out).toEqual([{ text: '日本語', mark: true }, { text: 'のドキュメント' }])
    expect(textOf(out)).toBe(text)
  })
})

describe('unescapeEntities', () => {
  test('decodes the named entities it supports, case-insensitively', () => {
    expect(unescapeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'')
    expect(unescapeEntities('a&nbsp;b')).toBe('a\u00A0b')
    expect(unescapeEntities('&AMP;&Lt;')).toBe('&<')
    expect(unescapeEntities('&lt;b&gt;hi&lt;/b&gt;')).toBe('<b>hi</b>')
  })

  test('decodes decimal and hex numeric references', () => {
    expect(unescapeEntities('&#38;&#60;&#39;')).toBe("&<'")
    expect(unescapeEntities('&#x26;&#X26;')).toBe('&&')
    expect(unescapeEntities('&#x1F600;')).toBe('\u{1F600}')
  })

  test('leaves unknown, malformed and out-of-range references alone', () => {
    expect(unescapeEntities('&copy;')).toBe('&copy;')
    expect(unescapeEntities('&#xZZ;')).toBe('&#xZZ;')
    expect(unescapeEntities('&amp')).toBe('&amp')
    expect(unescapeEntities('& amp;')).toBe('& amp;')
    // above the Unicode ceiling — String.fromCodePoint would throw
    expect(unescapeEntities('&#1114112;')).toBe('&#1114112;')
  })

  test('leaves plain text untouched, however often it runs', () => {
    const text = 'Plain text — nothing to decode (a & b stays a & b).'
    expect(unescapeEntities(text)).toBe(text)
    expect(unescapeEntities(unescapeEntities(text))).toBe(text)
  })

  test('decodes exactly one level, so ingest must call it once', () => {
    expect(unescapeEntities('&amp;lt;')).toBe('&lt;')
    expect(unescapeEntities(unescapeEntities('&amp;lt;'))).toBe('<')
  })
})

describe('fromTerms', () => {
  test('marks the ORIGINAL text, so display casing survives a lowercased term', () => {
    // regression (todo.md §2): slimsearch marks the raw query string instead
    const out = fromTerms('GitHub Actions and github.dev', ['github'])
    expect(textOf(out)).toBe('GitHub Actions and github.dev')
    expect(out.filter((seg) => seg.mark).map((seg) => seg.text)).toEqual(['GitHub', 'github'])
  })

  test('longest term first, so a short term cannot shadow a longer one', () => {
    expect(fromTerms('javascript', ['java', 'javascript'])).toEqual([
      { text: 'javascript', mark: true },
    ])
    expect(fromTerms('javascript', ['javascript', 'java'])).toEqual([
      { text: 'javascript', mark: true },
    ])
    expect(fromTerms('search searching', ['search', 'searching'])).toEqual([
      { text: 'search', mark: true },
      { text: ' ' },
      { text: 'searching', mark: true },
    ])
  })

  test('regex metacharacters in terms are matched literally', () => {
    expect(fromTerms('c++ and c#', ['c++'])).toEqual([
      { text: 'c++', mark: true },
      { text: ' and c#' },
    ])
    expect(fromTerms('a.b acb', ['.'])).toEqual([
      { text: 'a' },
      { text: '.', mark: true },
      { text: 'b acb' },
    ])
  })

  test('marks a term at the start and at the end', () => {
    expect(fromTerms('vue router', ['vue'])).toEqual([
      { text: 'vue', mark: true },
      { text: ' router' },
    ])
    expect(fromTerms('vue router', ['router'])).toEqual([
      { text: 'vue ' },
      { text: 'router', mark: true },
    ])
  })

  test('adjacent term matches merge into one mark', () => {
    expect(fromTerms('foobar', ['foo', 'bar'])).toEqual([{ text: 'foobar', mark: true }])
  })

  test('no match returns the text unmarked', () => {
    expect(fromTerms('hello world', ['zzz'])).toEqual([{ text: 'hello world' }])
  })

  test('no usable terms returns the text unmarked', () => {
    expect(fromTerms('hello', [])).toEqual([{ text: 'hello' }])
    expect(fromTerms('hello', ['', ''])).toEqual([{ text: 'hello' }])
    expect(fromTerms('', ['hello'])).toEqual([])
  })
})
