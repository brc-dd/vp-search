import { describe, expect, it } from 'vitest'

/**
 * Guard so an ICU-flavoured failure names itself: without full ICU,
 * `Intl.Segmenter` degrades to no word segmentation for CJK and every
 * tokenizer/CJK expectation in this package fails for one reason.
 */

// `icu_small` is real at runtime but absent from @types/node's ProcessConfig.
const variables = process.config.variables as unknown as Record<string, unknown>

const CAUSE =
  'This Node build lacks full ICU (small-icu or --without-intl). Reinstall an official ' +
  'Node ≥22.12 build, or set NODE_ICU_DATA — every CJK tokenizer expectation depends on it.'

describe('runtime environment', () => {
  it('runs on a full-ICU Node build', () => {
    expect(variables['icu_small'], CAUSE).toBe(false)
  })

  it('exposes Intl.Segmenter', () => {
    expect(typeof Intl.Segmenter, CAUSE).toBe('function')
  })

  it('segments CJK words rather than falling back to whole-run segments', () => {
    const segments = [...new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment('快速开始')]
    expect(segments.length, CAUSE).toBeGreaterThan(1)
  })

  it('runs with the pinned TZ so date-sensitive output is stable', () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC')
  })
})
