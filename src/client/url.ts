/**
 * Turns a result URL — absolute for crawler-based backends, site-relative for
 * build-time ones — into a path this site's router accepts, the same rewrite
 * the default theme applies to DocSearch hits.
 */
export function getRelativePath(url: string, cleanUrls?: boolean): string {
  const { pathname, hash } = new URL(url, location.origin)
  return pathname.replace(/\.html$/, cleanUrls ? '' : '.html') + hash
}
