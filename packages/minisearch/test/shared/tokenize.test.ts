import { describe, expect, it } from 'vitest'
import { createTokenizer } from '../../src/tokenize.ts'
import { LANG, ZH_LANG } from './helpers.ts'

/**
 * `Intl.Segmenter` word boundaries are implementation-defined (ECMA-402) and
 * ICU majors land in Node minors, so everything here asserts invariants rather
 * than exact token arrays — and always with an explicit locale tag.
 */

const CORPUS = [
  'Hello, world! foo-bar baz_qux',
  "don't stop  \n now",
  'VitePress 2.0 build/output',
  'docs 网站 build',
  'VitePress 是一个静态站点生成器，专为构建以内容为中心的 docs 网站而设计。',
  '   ',
  '',
  '……',
]

const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u

describe('createTokenizer invariants', () => {
  for (const lang of [LANG, ZH_LANG]) {
    describe(lang, () => {
      const tokenize = createTokenizer(lang)

      it('never yields an empty token', () => {
        for (const text of CORPUS) expect(tokenize(text).every(Boolean)).toBe(true)
      })

      it('yields only substrings of the input', () => {
        for (const text of CORPUS) {
          for (const token of tokenize(text)) expect(text).toContain(token)
        }
      })

      it('never yields a token containing whitespace', () => {
        for (const text of CORPUS) {
          for (const token of tokenize(text)) expect(token).not.toMatch(/\s/)
        }
      })

      it('yields nothing for whitespace-only or punctuation-only input', () => {
        expect(tokenize('')).toEqual([])
        expect(tokenize('   ')).toEqual([])
        expect(tokenize('……')).toEqual([])
      })
    })
  }
})

describe('createTokenizer, latin text', () => {
  const tokenize = createTokenizer(LANG)

  it('splits on whitespace and punctuation', () => {
    expect(tokenize('Hello, world! foo-bar')).toEqual(['Hello', 'world', 'foo', 'bar'])
  })

  it('collapses runs of whitespace', () => {
    expect(tokenize('a  \n\t b')).toEqual(['a', 'b'])
  })

  it('does not lowercase — MiniSearch owns term normalization via processTerm', () => {
    expect(tokenize('MiXeD CaSe')).toEqual(['MiXeD', 'CaSe'])
  })
})

describe('createTokenizer, mixed scripts', () => {
  it('yields both latin and CJK tokens from one string', () => {
    const tokens = createTokenizer(LANG)('docs 网站 build')
    expect(tokens.some((token) => /^[a-z]+$/i.test(token))).toBe(true)
    expect(tokens.some((token) => CJK.test(token))).toBe(true)
  })

  it('segments unspaced CJK into more than one token', () => {
    expect(createTokenizer(ZH_LANG)('快速开始只需要几分钟').length).toBeGreaterThan(1)
  })

  it('reassembles the CJK input from its tokens in order', () => {
    const text = '快速开始只需要几分钟'
    expect(createTokenizer(ZH_LANG)(text).join('')).toBe(text)
  })
})

describe('createTokenizer, degenerate locales', () => {
  it('falls back instead of throwing on a malformed BCP-47 tag', () => {
    const tokenize = createTokenizer('not a tag!!')
    expect(tokenize('hello world 网站').length).toBeGreaterThan(1)
  })

  it('still tokenizes with an unknown but well-formed tag', () => {
    expect(createTokenizer('qaa-Qaaa-QM')('hello world')).toEqual(['hello', 'world'])
  })
})
