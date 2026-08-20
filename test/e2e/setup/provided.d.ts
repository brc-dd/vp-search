import 'vitest'

declare module 'vitest' {
  /** Values `globalSetup` hands every worker through `provide`/`inject`. */
  export interface ProvidedContext {
    /** Origin of the fixture site, no trailing slash. */
    baseUrl: string
    /** WebSocket endpoint of the shared Chromium server. */
    wsEndpoint: string
    /** True when the site is a `vitepress build` served statically. */
    buildMode: boolean
  }
}
