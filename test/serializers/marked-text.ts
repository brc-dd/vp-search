import type { SnapshotSerializer } from 'vitest'
import type { MarkedText, TextSegment } from '../../packages/core/src/types.ts'

const KEYS = new Set(['text', 'mark'])

/** Renders `MarkedText` as `foo<mark>bar</mark>baz` so diffs read as text. */
const serializer: SnapshotSerializer = {
  // deliberately narrow: an ordinary array of objects must not be hijacked
  test(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (seg: unknown) =>
          typeof seg === 'object' &&
          seg !== null &&
          !Array.isArray(seg) &&
          typeof (seg as TextSegment).text === 'string' &&
          Object.keys(seg).every((key) => KEYS.has(key)),
      )
    )
  },
  serialize(value: MarkedText): string {
    return value.map((seg) => (seg.mark ? `<mark>${seg.text}</mark>` : seg.text)).join('')
  },
}

export default serializer
