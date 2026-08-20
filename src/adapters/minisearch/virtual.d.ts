declare module 'virtual:any-search/minisearch' {
  /** Null when the plugin runs another provider. */
  const data: import('./types.ts').IndexData | null
  export default data
}
