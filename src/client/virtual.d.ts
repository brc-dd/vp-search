declare module 'virtual:any-search/adapter' {
  const adapter: import('../adapter.ts').SearchAdapter
  export default adapter
}

declare module 'virtual:any-search/options' {
  const options: import('../translations.ts').SearchOptions
  export default options
}
