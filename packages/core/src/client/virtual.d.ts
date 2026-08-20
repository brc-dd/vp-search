declare module 'virtual:vp-search/adapter' {
  const adapter: import('../adapter.ts').SearchAdapter
  export default adapter
}

declare module 'virtual:vp-search/options' {
  const options: import('../translations.ts').SearchOptions
  export default options
}
