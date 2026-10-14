export type DispatchResult = { dispatched: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 15_000;

const DEFAULT_BASE_URL = "https://dashboard.rosably.com";

function httpOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** The dashboard's own configured base URL (DASHBOARD_BASE_URL), never derived from a request. */
export function dispatchBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DASHBOARD_BASE_URL?.trim().replace(/\/+$/, "");
  return (configured && httpOrigin(configured)) || DEFAULT_BASE_URL;
}

// Starts the assigned agent on a work item through the dashboard's own dispatch route
// (the same call PATCH /api/work/[id] makes), forwarding the caller's session cookie.
// `origin` is a configured base URL (see dispatchBaseUrl), never taken from the request,
// because the session cookie is sent to it.
export async function dispatchBeginWork(
  origin: string,
  workItemId: string,
  cookie: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchResult> {
  if (!UUID_RE.test(workItemId)) return { dispatched: false, error: "invalid work item id" };
  const base = httpOrigin(origin);
  if (!base) return { dispatched: false, error: "invalid origin" };
  try {
    const res = await fetchImpl(`${base}/api/work/${encodeURIComponent(workItemId)}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ action: "begin_work", suppress_notify: true }),
      redirect: "error",
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
