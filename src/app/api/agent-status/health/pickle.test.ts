import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

const calls: { url: string; headers: Record<string, string> }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("PICKLE_URL", "https://pickle.test");
  vi.stubEnv("JORDAN_WEBHOOK_SECRET", "jordan-secret");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return new Response(JSON.stringify({ ok: true, busy: true }));
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("health probe for Dr. Pickle", () => {
  it("probes the public /health and never sends a secret there", async () => {
    const rows = await (await GET()).json();
    expect(rows.find((r: { agent: string }) => r.agent === "pickle")).toMatchObject({ status: "up", detail: { busy: true } });
    const c = calls.find(c => c.url === "https://pickle.test/health")!;
    expect(c.headers["x-webhook-secret"]).toBeUndefined();
  });
});
