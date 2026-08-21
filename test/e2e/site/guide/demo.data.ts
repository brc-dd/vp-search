/**
 * VitePress data loader. `load()` runs in node while the page is being built, so its output exists
 * in the rendered HTML and nowhere in the markdown source.
 */
export default {
  load: () => ({ token: 'loadertoken9001' }),
}
