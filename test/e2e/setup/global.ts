import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { build, createServer, serve } from 'vitepress'
import type { TestProject } from 'vitest/node'

/** The fixture site, not `examples/docs` — see DESIGN §13. */
const root = fileURLToPath(new URL('../site', import.meta.url))

/** Dev and built output diverge (inlined dev locales vs fetched hashed artifacts). */
const buildMode = !!process.env['VP_E2E_BUILD']

interface Site {
  baseUrl: string
  close: () => Promise<void>
}

/**
 * One Chromium server plus one fixture site for the whole `e2e` project; per-file workers connect
 * over WS and address the site through `baseUrl`.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Ordered browser-first so the site server never waits on live sockets.
  const stops: Array<() => Promise<void>> = []

  try {
    const browserServer = await chromium.launchServer({
      headless: true,
      // The GitHub runner's sandbox is unavailable to an unprivileged container.
      // Nothing else belongs here: playwright's default chromiumSwitches already
      // carry the CI-hardening set (--disable-dev-shm-usage included), and extra
      // --disable-features flags would REPLACE its curated list (last one wins).
      ...(process.env['CI'] && { args: ['--no-sandbox', '--disable-setuid-sandbox'] }),
    })
    stops.push(() => browserServer.close())

    const site = await startSite()
    stops.push(site.close)

    project.provide('wsEndpoint', browserServer.wsEndpoint())
    project.provide('baseUrl', site.baseUrl)
    project.provide('buildMode', buildMode)
  } catch (error) {
    // Whatever did start must still come down, or the run leaks a browser.
    await stopAll(stops)
    throw error
  }

  return () => stopAll(stops)
}

async function startSite(): Promise<Site> {
  if (!buildMode) {
    // Vite picks the port; `resolvedUrls` is the only authority on which one.
    const server = await createServer(root, { host: '127.0.0.1' })
    await server.listen()
    const url = server.resolvedUrls?.local[0]
    if (!url) throw new Error('[vp-search e2e] the dev server reported no local URL')
    return { baseUrl: url.replace(/\/+$/, ''), close: () => server.close() }
  }

  // `build()` sets NODE_ENV=production process-wide and never puts it back;
  // the workers spawn after this and should still see vitest's own `test`.
  const nodeEnv = process.env['NODE_ENV']
  try {
    await build(root)
    // Port 0 lets the OS assign, so nothing races a "is this port free" probe.
    const app = await serve({ root, port: 0 })
    // polka's bundled types call this a `net.Server`; it is an http one.
    const server = app.server as Server
    const { port } = server.address() as AddressInfo
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve, reject) => {
          // sirv keeps connections alive; `close` alone would wait them out.
          server.closeAllConnections()
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    }
  } finally {
    if (nodeEnv === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = nodeEnv
  }
}

/** Runs every stop, reporting the first failure only after all have been tried. */
async function stopAll(stops: Array<() => Promise<void>>): Promise<void> {
  let failure: unknown
  for (const stop of stops.splice(0)) {
    try {
      await stop()
    } catch (error) {
      failure ??= error
    }
  }
  if (failure) throw failure
}
