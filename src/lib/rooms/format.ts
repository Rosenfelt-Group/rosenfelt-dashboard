import { formatDistanceToNow } from "date-fns";

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "Oct 14, 2026" in the viewer's time zone (or the zone given, for tests).
export function formatVersionDate(value: string | Date | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}),
    }).format(d);
  } catch {
    return "";
  }
}

// "3 days ago", or undefined for an unusable date (never throws).
export function formatRelativeTitle(value: string | Date | null | undefined): string | undefined {
  const d = toDate(value);
  return d ? formatDistanceToNow(d, { addSuffix: true }) : undefined;
}
