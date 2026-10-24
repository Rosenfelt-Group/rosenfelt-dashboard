// CRM search input handling for /api/crm/search (⌘K) and /api/crm/contacts?q=. Pure, so it can be
// unit-tested. The search term goes into PostgREST or() filters, so anything that could change the
// filter's meaning (commas, parentheses, quotes, backslashes, wildcards, colons) is dropped.

export const MIN_QUERY = 2;
export const MAX_QUERY = 80;

/** The cleaned search term, or null when there is nothing worth searching for. */
export function parseSearchQuery(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const q = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}@.\-_'&+ ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY)
    .trim();
  return q.length >= MIN_QUERY ? q : null;
}

/** A positive integer limit, clamped to [1, max]; `fallback` when missing or invalid. */
export function parseLimit(raw: string | null | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** `col.ilike.*term*` for each column, joined for .or(). `term` must come from parseSearchQuery. */
export function ilikeAny(columns: string[], term: string): string {
  return columns.map(c => `${c}.ilike.*${term}*`).join(",");
}

/**
 * The .or() filter for people: any of first name, last name or email contains the whole term, or,
 * for a two-part term such as "dana whit", the first name contains the first part and the last name
 * the rest.
 */
export function contactSearchFilter(term: string): string {
  const parts = term.split(" ");
  const filters = [ilikeAny(["first_name", "last_name", "email"], term)];
  if (parts.length >= 2) {
    filters.push(`and(first_name.ilike.*${parts[0]}*,last_name.ilike.*${parts.slice(1).join(" ")}*)`);
  }
  return filters.join(",");
}

export type SearchHit = { id: string; label: string; detail: string | null; href: string };
export type SearchResults = { organizations: SearchHit[]; people: SearchHit[]; deals: SearchHit[] };
export const EMPTY_RESULTS: SearchResults = { organizations: [], people: [], deals: [] };
