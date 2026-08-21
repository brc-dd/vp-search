/**
 * Shared by the node indexer and the search worker. MiniSearch never serializes its tokenizer, so
 * both sides must rebuild an identical one from the artifact's `lang` — any drift silently makes
 * indexed terms unsearchable. Keep this module dependency-free: the worker imports it too.
 */

/** MiniSearch's own default split, used when `Intl.Segmenter` is unavailable. */
const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u

export type Tokenizer = (text: string) => string[]

/** Builds a tokenizer for `lang` — `Intl.Segmenter` when available, else punctuation-split. */
export function createTokenizer(lang: string): Tokenizer {
  const segmenter = createSegmenter(lang)
  if (!segmenter) {
    return (text) => text.split(SPACE_OR_PUNCTUATION).filter(Boolean)
  }
  return (text) => {
    const tokens: string[] = []
    for (const { segment, isWordLike } of segmenter.segment(text)) {
      if (isWordLike) tokens.push(segment)
    }
    return tokens
  }
}

function createSegmenter(lang: string): Intl.Segmenter | undefined {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return
  try {
    return new Intl.Segmenter(lang, { granularity: 'word' })
  } catch {
    // A malformed BCP-47 tag from site config must not break indexing.
    try {
      return new Intl.Segmenter(undefined, { granularity: 'word' })
    } catch {
      return
    }
  }
}
