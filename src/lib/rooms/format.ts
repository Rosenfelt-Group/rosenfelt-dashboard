// "Oct 14, 2026" in the viewer's time zone (or the zone given, for tests).
export function formatVersionDate(value: string | Date, timeZone?: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}),
  }).format(d);
}
