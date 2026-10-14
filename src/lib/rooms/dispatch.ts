export type DispatchResult = { dispatched: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 15_000;

// Starts the assigned agent on a work item through the dashboard's own dispatch route
// (the same call PATCH /api/work/[id] makes), forwarding the caller's session cookie.
// `origin` must be the request's own origin; it is never taken from user input.
export async function dispatchBeginWork(
  origin: string,
  workItemId: string,
  cookie: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchResult> {
  if (!UUID_RE.test(workItemId)) return { dispatched: false, error: "invalid work item id" };
  let base: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    base = u.origin;
  } catch {
    return { dispatched: false, error: "invalid origin" };
  }
  try {
    const res = await fetchImpl(`${base}/api/work/${encodeURIComponent(workItemId)}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ action: "begin_work", suppress_notify: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { dispatched: false, error: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    return body && body.dispatched === true
      ? { dispatched: true }
      : { dispatched: false, error: "the agent did not accept the dispatch" };
  } catch {
    return { dispatched: false, error: "network error" };
  }
}
