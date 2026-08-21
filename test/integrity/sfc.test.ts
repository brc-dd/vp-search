/**
 * Guards `patches/vue-sfc-transformer.patch`: the built SFCs (`packages/core/dist/client/*.vue`)
 * must survive the real consumer pipeline (`@vue/compiler-sfc`, postcss scoping) with the TS
 * source's binding metadata and style blocks unchanged (modulo the transformer's blank-line
 * normalize) — catches oxc dropping template-only imports and the synthesized `export {}`. If the
 * patch stops applying, or an upstream release changes shape, this fails here rather than in a
 * consumer's build.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { BindingMetadata, SFCParseResult } from 'vue/compiler-sfc'

const CORE = fileURLToPath(new URL('../../packages/core/', import.meta.url))

// Resolved through the core package, exactly as a consumer's toolchain would.
const req = createRequire(join(CORE, 'package.json'))
const { compileScript, compileStyle, compileTemplate, parse } = req(
  'vue/compiler-sfc',
) as typeof import('vue/compiler-sfc')

/** Just enough of postcss to re-parse a style block; loaded via vite's copy. */
interface PostcssLike {
  parse(css: string): { toResult(): { css: string } }
}
const postcss = createRequire(req.resolve('vite/package.json'))('postcss') as PostcssLike

const COMPONENTS = ['VPMarkedText', 'VPNavBarSearch', 'VPSearchBox']

/**
 * The transformer's own whitespace normalization (rolldown plugin): collapse 3+ newlines to a blank
 * line, trim leading/trailing blank lines.
 */
const normalize = (s: string) => s.replace(/(\n\n)\n+/g, '\n\n').replace(/^\s*\n|\n\s*$/g, '')

/** Modern CSS the transformer must pass through untouched, never lower. */
const MODERN_CSS: Record<string, RegExp> = {
  'native nesting (&)': /^\s*&/m,
  '@starting-style': /@starting-style/,
  'range media query': /@media\s*\([a-z-]+\s*[<>]=?/,
  'custom properties': /var\(--/,
  ':deep()': /:deep\(/,
}

const featuresIn = (css: string) =>
  Object.entries(MODERN_CSS)
    .filter(([, re]) => re.test(css))
    .map(([feature]) => feature)

type Side = 'src' | 'dist'

// Parsing and script compilation are lazy + memoized: nothing may touch `dist/` at collection time,
// or a clean checkout would fail instead of skip.
const parses = new Map<string, SFCParseResult>()
const scripts = new Map<string, BindingMetadata | undefined>()

function parsed(name: string, side: Side): SFCParseResult {
  const key = `${side}/${name}`
  let result = parses.get(key)
  if (!result) {
    const file = join(CORE, side, 'client', `${name}.vue`)
    result = parse(readFileSync(file, 'utf8'), { filename: `${name}.vue` })
    parses.set(key, result)
  }
  return result
}

function bindingsOf(name: string, side: Side): BindingMetadata | undefined {
  const key = `${side}/${name}`
  if (!scripts.has(key)) {
    scripts.set(key, compileScript(parsed(name, side).descriptor, { id: 'test' }).bindings)
  }
  return scripts.get(key)
}

const BUILT = existsSync(join(CORE, 'dist/client'))
const SUITE = BUILT
  ? 'dist SFC integrity'
  : 'dist SFC integrity — SKIPPED: packages/core/dist/client is missing, run `pnpm build` first'

describe.skipIf(!BUILT)(SUITE, () => {
  describe.each(COMPONENTS)('%s.vue', (name) => {
    test('dist SFC parses clean', () => {
      expect(parsed(name, 'dist').errors).toEqual([])
    })

    test('scriptSetup lang is stripped (TS transpiled out)', () => {
      expect(parsed(name, 'src').descriptor.scriptSetup?.lang).toBe('ts')
      const setup = parsed(name, 'dist').descriptor.scriptSetup
      expect(setup).not.toBeNull()
      expect(setup?.lang).toBeUndefined()
    })

    test('dist compileScript bindings match the TS source descriptor', () => {
      const src = bindingsOf(name, 'src')
      const dist = bindingsOf(name, 'dist')
      expect(Object.keys(src ?? {}).length).toBeGreaterThan(0)
      expect(Object.keys(dist ?? {}).sort()).toEqual(Object.keys(src ?? {}).sort())
      // spread: module-level binding objects compare as plain records
      expect({ ...dist }).toEqual({ ...src })
    })

    test('dist template compiles error-free with the dist bindings', () => {
      const { descriptor } = parsed(name, 'dist')
      expect(descriptor.template).not.toBeNull()
      const bindings = bindingsOf(name, 'dist')
      expect(bindings).toBeDefined()
      const result = compileTemplate({
        source: descriptor.template!.content,
        filename: `${name}.vue`,
        id: 'test',
        scoped: descriptor.styles.some((style) => style.scoped),
        compilerOptions: { bindingMetadata: bindings! },
      })
      expect(result.errors).toEqual([])
    })

    test('template line count is preserved modulo the blank-line normalize', () => {
      const src = parsed(name, 'src').descriptor.template
      const dist = parsed(name, 'dist').descriptor.template
      expect(src).not.toBeNull()
      expect(dist).not.toBeNull()
      const lines = (content: string) => normalize(content).split('\n').length
      expect(lines(dist!.content)).toBe(lines(src!.content))
    })

    test('style block count and attrs are identical', () => {
      const src = parsed(name, 'src').descriptor.styles
      const dist = parsed(name, 'dist').descriptor.styles
      expect(dist).toHaveLength(src.length)
      expect(dist.map((style) => style.attrs)).toEqual(src.map((style) => style.attrs))
    })

    test('style content is byte-preserved modulo the blank-line normalize', () => {
      const content = (side: Side) =>
        parsed(name, side).descriptor.styles.map((style) => normalize(style.content))
      expect(content('dist')).toEqual(content('src'))
    })

    test('postcss parses dist styles to the same AST as the source', () => {
      const ast = (side: Side) =>
        parsed(name, side).descriptor.styles.map((style) =>
          normalize(postcss.parse(style.content).toResult().css),
        )
      expect(ast('dist')).toEqual(ast('src'))
    })

    test('compileStyle (postcss + scoping) succeeds on every dist style', () => {
      const styles = parsed(name, 'dist').descriptor.styles
      for (const [index, style] of styles.entries()) {
        const compiled = compileStyle({
          source: style.content,
          filename: `${name}.vue`,
          id: 'data-v-test1234',
          scoped: !!style.scoped,
        })
        expect(compiled.errors, `style[${index}]`).toEqual([])
      }
    })

    test('modern CSS features present in the source are not lowered', () => {
      const features = (side: Side) =>
        parsed(name, side).descriptor.styles.map((style) => featuresIn(style.content))
      expect(features('dist')).toEqual(features('src'))
    })
  })

  test('every guarded CSS feature is exercised by some source style', () => {
    const seen = new Set<string>()
    for (const name of COMPONENTS) {
      for (const style of parsed(name, 'src').descriptor.styles) {
        for (const feature of featuresIn(style.content)) seen.add(feature)
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(MODERN_CSS).sort())
  })
})
