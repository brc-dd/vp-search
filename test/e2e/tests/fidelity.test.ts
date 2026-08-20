import { beforeEach, describe, expect, inject, test } from 'vitest'
import { goto, page } from '../setup/browser.ts'
import { openByClick, options, query, queryEmpty } from '../setup/search.ts'

/**
 * DESIGN §11's fidelity contract, made executable. A build indexes final HTML,
 * so everything the render produces is in it; dev re-renders markdown with the
 * configured renderer instead, so it sees the source and whatever that
 * renderer's own plugins expand. Each token below is unique to one record, and
 * `where` is the measured reality — a case flipping sides is the signal that
 * the gap moved.
 */
type Where = 'build' | 'dev' | 'both'

interface Case {
  what: string
  token: string
  href: string
  where: Where
}

const CASES: readonly Case[] = [
  // Rendered-only: the markdown carries a placeholder, the page carries a value.
  {
    what: 'a dynamic route (#2939)',
    token: 'alfaroute2939',
    href: '/guide/alfa.html#package-page',
    where: 'build',
  },
  {
    what: "a vite transform's output (#4979)",
    token: 'xformtoken4979',
    href: '/guide/transformed.html#transformed-page',
    where: 'build',
  },
  {
    what: 'the source that transform replaced',
    token: 'rawslot4979x',
    href: '/guide/transformed.html#transformed-page',
    where: 'dev',
  },
  {
    what: 'an interpolated frontmatter value (#4934)',
    token: 'fmtoken4934x',
    href: '/guide/frontmatter.html#frontmatter-page',
    where: 'build',
  },
  {
    what: 'a `<script setup>` value',
    token: 'scriptvalue8811',
    href: '/guide/vue.html#script-value',
    where: 'build',
  },
  {
    what: "a data loader's output",
    token: 'loadertoken9001',
    href: '/guide/vue.html#loader-data',
    where: 'build',
  },
  // Both: dev indexes the raw slot text where a build indexes rendered output.
  {
    what: "a component's slot text",
    token: 'badgeslot8822',
    href: '/guide/vue.html#slot-text',
    where: 'both',
  },
  // Both: `@include` and `<<<` are markdown-it plugins, so the dev renderer
  // expands them exactly as the build does.
  {
    what: 'an `@include` partial',
    token: 'includetoken2812',
    href: '/guide/expansions.html#included-partial',
    where: 'both',
  },
  {
    what: 'a `<<<` code snippet',
    token: 'snippettoken4321',
    href: '/guide/expansions.html#imported-snippet',
    where: 'both',
  },
  // The one case that runs the other way: SSR renders `<ClientOnly>` as nothing,
  // so a build indexes nothing, while dev sees the raw slot text.
  {
    what: 'a `<ClientOnly>` slot',
    token: 'clientonly7733',
    href: '/guide/vue.html#client-only',
    where: 'dev',
  },
]

const buildMode = inject('buildMode')

function findable(where: Where): boolean {
  return where === 'both' || where === (buildMode ? 'build' : 'dev')
}

beforeEach(async () => {
  await goto('/')
})

for (const testCase of CASES) {
  const found = findable(testCase.where)
  test(`${testCase.what} is ${found ? 'findable' : 'not findable'}`, async () => {
    await openByClick()
    if (!found) {
      await queryEmpty(testCase.token)
      await expect(options().count()).resolves.toBe(0)
      return
    }
    await query(testCase.token, 1)
    await expect(options().first().locator('a.result-link').getAttribute('href')).resolves.toBe(
      testCase.href,
    )
  })
}

describe.skipIf(!buildMode)('build only', () => {
  test('the second route of one template is its own record', async () => {
    await openByClick()
    await query('bravoroute2939', 1)
    await expect(options().first().locator('a.result-link').getAttribute('href')).resolves.toBe(
      '/guide/bravo.html#package-page',
    )
  })
})

describe.skipIf(buildMode)('dev only', () => {
  test('a dynamic route the index misses is still a page that serves', async () => {
    await goto('/guide/alfa.html')
    await expect(page().locator('main').textContent()).resolves.toContain('alfaroute2939')
  })
})
