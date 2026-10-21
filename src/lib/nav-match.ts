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

/**
 * The nav items that own `pathname`: those whose longest matching `active`
 * prefix is the longest of all items. A well-formed nav yields exactly one, so
 * /content/research belongs to Research even though /content (Content) also
 * prefixes it.
 */
export function matchingItems<T extends { active: string[] }>(items: T[], pathname: string): T[] {
  let best = -1;
  let hits: T[] = [];
  for (const item of items) {
    const len = Math.max(-1, ...item.active.filter(a => pathMatches(a, pathname)).map(a => a.length));
    if (len < 0) continue;
    if (len > best) { best = len; hits = [item]; } else if (len === best) hits.push(item);
  }
  return hits;
}
