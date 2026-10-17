export type FetchJsonResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/** fetch + JSON parse that never throws; failures come back as { ok: false, error }. */
export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<FetchJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: "Network error" };
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) return { ok: false, error: "Unexpected response (are you signed in?)" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Unexpected response (are you signed in?)" };
  }
  if (!res.ok) {
    const e = (body as { error?: unknown } | null)?.error;
    return { ok: false, error: typeof e === "string" ? e : `Request failed (HTTP ${res.status})`, status: res.status };
  }
  return { ok: true, data: body as T };
}
