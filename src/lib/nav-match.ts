// Path matching for the sidebar and section sub-nav. Kept free of React so it
// can be unit-tested.

/** True when `pathname` is `prefix` or a page beneath it. */
export function pathMatches(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * The single sub-page that should be highlighted: the one whose href (or one
 * of its extra `match` prefixes) is the longest prefix of `pathname`. This
 * stops a parent page such as /content from lighting up alongside
 * /content/keywords.
 */
export function activeSubPageHref(
  pages: { href: string; match?: string[] }[],
  pathname: string,
): string | null {
  let best: { href: string; length: number } | null = null;
  for (const page of pages) {
    for (const prefix of [page.href, ...(page.match ?? [])]) {
      if (pathMatches(prefix, pathname) && (!best || prefix.length > best.length)) {
        best = { href: page.href, length: prefix.length };
      }
    }
  }
  return best?.href ?? null;
}
