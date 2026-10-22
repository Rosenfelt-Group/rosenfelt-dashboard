// Client for Riley's discovery endpoints (POST /discovery/draft-questionnaire and /discovery/brief).
// Auth is X-Webhook-Secret = RILEY_DISCOVERY_SECRET (not the general agent webhook secret).
// Fail closed: with either env var unset, nothing is requested. Riley's error text is logged here,
// never returned, so it cannot reach the browser.

export class RileyNotConfiguredError extends Error {
  constructor() {
    super("Riley discovery is not configured (RILEY_AGENT_URL / RILEY_DISCOVERY_SECRET)");
    this.name = "RileyNotConfiguredError";
  }
}

export type RileyFailKind = "not_found" | "conflict" | "invalid" | "failed" | "unreachable";
export type RileyResult<T> = { ok: true; data: T } | { ok: false; kind: RileyFailKind; status?: number };

export type DraftResponse = { sections: unknown[]; added_custom: number };
export type BriefResponse = {
  status: string;
  brief_id: string;
  scope_version_id: string | null;
  fit_verdict: "strong" | "possible" | "poor" | null;
  warning?: string;
};

export const DRAFT_TIMEOUT_MS = 180_000;
export const BRIEF_TIMEOUT_MS = 280_000;

function kindFor(status: number): RileyFailKind {
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "invalid";
  return "failed";
}

async function call<T>(path: string, inviteId: string, timeoutMs: number, valid: (b: unknown) => boolean): Promise<RileyResult<T>> {
  const base = process.env.RILEY_AGENT_URL;
  const secret = process.env.RILEY_DISCOVERY_SECRET;
  if (!base || !secret) throw new RileyNotConfiguredError();

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ invite_id: inviteId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    console.error("riley discovery unreachable", path, e instanceof Error ? e.name : "error");
    return { ok: false, kind: "unreachable" };
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    console.error("riley discovery error", path, res.status, typeof detail === "string" ? detail.slice(0, 300) : "");
    return { ok: false, kind: kindFor(res.status), status: res.status };
  }
  if (!valid(body)) {
    console.error("riley discovery unexpected body", path, res.status);
    return { ok: false, kind: "failed", status: res.status };
  }
  return { ok: true, data: body as T };
}

const isObj = (b: unknown): b is Record<string, unknown> => typeof b === "object" && b !== null;

export function draftQuestionnaire(inviteId: string): Promise<RileyResult<DraftResponse>> {
  return call("/discovery/draft-questionnaire", inviteId, DRAFT_TIMEOUT_MS,
    b => isObj(b) && Array.isArray(b.sections) && typeof b.added_custom === "number");
}

export function requestBrief(inviteId: string): Promise<RileyResult<BriefResponse>> {
  return call("/discovery/brief", inviteId, BRIEF_TIMEOUT_MS,
    b => isObj(b) && typeof b.status === "string" && typeof b.brief_id === "string");
}
