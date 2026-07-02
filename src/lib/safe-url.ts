/** Returns the URL unchanged if it's http(s), otherwise null. Use before rendering any
 *  stored/user-controllable URL as an href, to block javascript:/data:/etc. schemes. */
export function safeHref(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
