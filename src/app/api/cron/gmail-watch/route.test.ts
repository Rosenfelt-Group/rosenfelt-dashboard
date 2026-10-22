import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { fakeDb as db } from "@/lib/email/test-supabase";

vi.mock("@/lib/supabase-admin", async () => ({ supabaseAdmin: (await import("@/lib/email/test-supabase")).fakeDb.supabaseAdmin }));
const gm = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock("@/lib/email/gmail-user", async (orig) => ({ ...(await orig<object>()), gmailRead: () => gm }));

import { GET } from "./route";

const req = (auth?: string) => ({ headers: new Headers(auth ? { authorization: auth } : {}) }) as unknown as NextRequest;
const H = 3600_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("GMAIL_WATCH_TOPIC", "projects/p/topics/t");
  db.state.row = { history_id: "100", watch_expiration: null, last_full_sync_at: null };
  db.state.logs = [];
  gm.watch.mockResolvedValue({ historyId: "555", expiration: String(Date.now() + 7 * 24 * H) });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/gmail-watch", () => {
  it("requires the bearer secret and fails closed when unset", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect((await GET(req("Bearer s3cret!"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect(gm.watch).not.toHaveBeenCalled();
  });

  it("cron_renews_only_near_expiry", async () => {
    // far from expiry: nothing
    db.state.row.watch_expiration = new Date(Date.now() + 100 * H).toISOString();
    let body = await (await GET(req("Bearer s3cret"))).json();
    expect(gm.watch).not.toHaveBeenCalled();
    expect(body.jobs[0]).toMatchObject({ name: "gmail-watch", renewed: false });
    // near expiry: renew, keep existing cursor
    db.state.row.watch_expiration = new Date(Date.now() + 10 * H).toISOString();
    body = await (await GET(req("Bearer s3cret"))).json();
    expect(gm.watch).toHaveBeenCalledWith("projects/p/topics/t");
    expect(body.jobs[0]).toMatchObject({ renewed: true });
    expect(db.state.row.history_id).toBe("100");
    expect(new Date(db.state.row.watch_expiration!).getTime()).toBeGreaterThan(Date.now() + 100 * H);
  });

  it("renews when expiration is null and seeds the cursor only if absent", async () => {
    db.state.row.history_id = null;
    await GET(req("Bearer s3cret"));
    expect(gm.watch).toHaveBeenCalledTimes(1);
    expect(db.state.row.history_id).toBe("555");
  });

  it("reports a job failure in the summary and workflow_logs", async () => {
    gm.watch.mockRejectedValue(new Error("nope"));
    const res = await GET(req("Bearer s3cret"));
    const body = await res.json();
    expect(body.jobs[0]).toMatchObject({ name: "gmail-watch", ok: false });
    expect(db.state.logs[0]).toMatchObject({ workflow_name: "gmail-watch", status: "error" });
  });
});
