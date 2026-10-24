// Task 6 (Casey design-only): the dashboard's job routes call the checks service, not Casey.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// AGENT_URLS / AGENT_SECRETS are read at import time, so Casey's env is set before the imports.
vi.hoisted(() => {
  process.env.CASEY_AGENT_URL = "https://casey.test";
  process.env.CASEY_WEBHOOK_SECRET = "casey-secret";
});
const s = vi.hoisted(() => ({
  session: null as { username: string; role: string; permissions: string[] } | null,
  row: { min_interval_seconds: 300 } as Record<string, unknown> | null,
  updates: [] as unknown[],
}));
vi.mock("@/lib/session", () => ({ COOKIE_NAME: "dashboard_session", verifySessionToken: vi.fn(async () => s.session) }));
vi.mock("@/lib/supabase-admin", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self, eq: self, order: self,
    single: async () => ({ data: s.row, error: null }),
    update: (u: unknown) => { s.updates.push(u); return { eq: () => ({ eq: async () => ({ error: null }) }) }; },
  });
  return { supabaseAdmin: { from: () => chain } };
});

import { POST as regression } from "../regression/run/route";
import { POST as patch } from "../patch/detect/run/route";
import { POST as alignment } from "../alignment/run/route";
import { PATCH as cronPatch } from "../cron-config/route";
import { GET as cronJobs } from "../cron-config/jobs/route";
import { GET as health } from "../agent-status/health/route";

const calls: { url: string; headers: Record<string, string> }[] = [];
const req = (url: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://x${url}`, {
    method: init.method ?? "POST",
    headers: { cookie: "dashboard_session=t", "content-type": "application/json" },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

beforeEach(() => {
  s.session = { username: "brian", role: "admin", permissions: [] };
  s.updates = [];
  calls.length = 0;
  vi.stubEnv("CHECKS_URL", "https://checks.test");
  vi.stubEnv("CHECKS_WEBHOOK_SECRET", "checks-secret");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (url.endsWith("/scheduler/jobs")) {
      const agent = url.includes("checks.test") ? "checks" : "casey";
      return new Response(JSON.stringify({ jobs: [{ job_id: "memory_maintenance", next_run_time: `${agent}-time`, trigger: "t" }] }));
    }
    return new Response(JSON.stringify({ status: "ok", result: {} }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe.each([
  ["regression", regression, "/api/regression/run", "/regression/run"],
  ["patch", patch, "/api/patch/detect/run", "/patch/detect/run"],
  ["alignment", alignment, "/api/alignment/run", "/alignment/run"],
] as const)("%s run", (_name, handler, path, target) => {
  it(`calls checks with the checks secret`, async () => {
    const res = await handler(req(path));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://checks.test${target}`);
    expect(calls[0].headers["x-webhook-secret"]).toBe("checks-secret");
    expect(calls[0].headers["x-triggered-by-user"]).toBe("brian");
  });
  it("needs an admin and a configured checks service", async () => {
    s.session = { username: "v", role: "viewer", permissions: [] };
    expect((await handler(req(path))).status).toBe(403);
    s.session = { username: "brian", role: "admin", permissions: [] };
    vi.stubEnv("CHECKS_WEBHOOK_SECRET", "");
    expect((await handler(req(path))).status).toBe(500);
    expect(calls).toHaveLength(0);
  });
});

describe("cron config", () => {
  it("reschedules checks jobs on checks", async () => {
    const res = await cronPatch(req("/api/cron-config", { method: "PATCH", body: { agent: "checks", job_id: "memory_maintenance", cron: "*/10 * * * *" } }));
    expect((await res.json()).status).toBe("ok");
    expect(calls.map(c => c.url)).toEqual(["https://checks.test/scheduler/reschedule"]);
    expect(calls[0].headers["x-webhook-secret"]).toBe("checks-secret");
  });
  it("still reschedules casey rows on casey", async () => {
    await cronPatch(req("/api/cron-config", { method: "PATCH", body: { agent: "casey", job_id: "weekly_audit", enabled: false } }));
    expect(calls.map(c => c.url)).toEqual(["https://casey.test/scheduler/reschedule"]);
  });
  it("lists jobs from casey and checks, tagged by service so equal job ids do not collide", async () => {
    const body = await (await cronJobs(req("/api/cron-config/jobs", { method: "GET" }))).json();
    expect(body.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: "checks", job_id: "memory_maintenance", next_run_time: "checks-time" }),
      expect.objectContaining({ agent: "casey", job_id: "memory_maintenance", next_run_time: "casey-time" }),
    ]));
  });
});

describe("health", () => {
  it("lists checks", async () => {
    const rows = await (await health()).json();
    const checks = rows.find((r: { agent: string }) => r.agent === "checks");
    expect(checks).toMatchObject({ status: "up" });
    expect(calls.some(c => c.url === "https://checks.test/health")).toBe(true);
  });
});
