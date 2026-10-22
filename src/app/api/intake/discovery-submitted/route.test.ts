import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  live: [] as unknown[],
  insertError: null as { code?: string; message: string } | null,
  inserts: [] as Record<string, unknown>[],
  afterFns: [] as (() => unknown)[],
  runBrief: vi.fn(),
}));

vi.mock("next/server", async orig => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { s.afterFns.push(fn); } }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.in = () => b;
        b.limit = async () => ({ data: s.live, error: null });
        b.maybeSingle = async () => ({ data: s.invite, error: null });
        b.insert = (row: Record<string, unknown>) => { s.inserts.push({ table, ...row }); return Promise.resolve({ error: s.insertError }); };
        return b;
      },
    }),
  },
}));
vi.mock("@/lib/discovery/briefs", () => ({ runBrief: (...a: unknown[]) => s.runBrief(...a) }));

import { POST, maxDuration } from "./route";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const req = (body: unknown, auth?: string) =>
  ({ headers: new Headers(auth ? { authorization: auth } : {}), json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  s.invite = { id: ID, status: "submitted" };
  s.live = [];
  s.insertError = null;
  s.inserts = [];
  s.afterFns = [];
  s.runBrief = vi.fn().mockResolvedValue({ ok: true, data: {} });
  process.env.INTAKE_SECRET_WORDPRESS = "wp-secret";
  process.env.INTAKE_SECRET_N8N = "n8n-secret";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/intake/discovery-submitted", () => {
  it("allows 300s", () => expect(maxDuration).toBe(300));

  it("401 with no or a wrong secret", async () => {
    expect((await POST(req({ invite_id: ID }))).status).toBe(401);
    expect((await POST(req({ invite_id: ID }, "Bearer nope"))).status).toBe(401);
    expect(s.afterFns).toHaveLength(0);
  });

  it("403 for the n8n secret", async () => {
    expect((await POST(req({ invite_id: ID }, "Bearer n8n-secret"))).status).toBe(403);
    expect(s.inserts).toHaveLength(0);
    expect(s.afterFns).toHaveLength(0);
  });

  it("400 for a bad body", async () => {
    for (const body of [null, {}, { invite_id: "nope" }, { invite_id: 5 }]) {
      expect((await POST(req(body, "Bearer wp-secret"))).status).toBe(400);
    }
  });

  it("404 for an unknown invite, 409 when not submitted", async () => {
    s.invite = null;
    expect((await POST(req({ invite_id: ID }, "Bearer wp-secret"))).status).toBe(404);
    s.invite = { id: ID, status: "sent" };
    expect((await POST(req({ invite_id: ID }, "Bearer wp-secret"))).status).toBe(409);
    expect(s.afterFns).toHaveLength(0);
  });

  it("202, inserts a pending brief, and schedules Riley via after()", async () => {
    const res = await POST(req({ invite_id: ID }, "Bearer wp-secret"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true });
    expect(s.inserts).toEqual([{ table: "discovery_briefs", invite_id: ID, status: "pending" }]);
    expect(s.runBrief).not.toHaveBeenCalled();
    expect(s.afterFns).toHaveLength(1);
    await s.afterFns[0]();
    expect(s.runBrief).toHaveBeenCalledWith(ID);
  });

  it("202 without inserting when a live brief exists", async () => {
    s.live = [{ id: "b1" }];
    const res = await POST(req({ invite_id: ID }, "Bearer wp-secret"));
    expect(res.status).toBe(202);
    expect(s.inserts).toHaveLength(0);
    expect(s.afterFns).toHaveLength(1);
  });

  it("202 when the insert loses a race (unique violation)", async () => {
    s.insertError = { code: "23505", message: "duplicate key" };
    expect((await POST(req({ invite_id: ID }, "Bearer wp-secret"))).status).toBe(202);
    expect(s.afterFns).toHaveLength(1);
  });

  it("500 on any other insert error, and Riley is not scheduled", async () => {
    s.insertError = { code: "XX000", message: "boom" };
    expect((await POST(req({ invite_id: ID }, "Bearer wp-secret"))).status).toBe(500);
    expect(s.afterFns).toHaveLength(0);
  });

  it("the after() job swallows Riley errors (logged only)", async () => {
    s.runBrief.mockRejectedValue(new Error("not configured"));
    await POST(req({ invite_id: ID }, "Bearer wp-secret"));
    await expect(s.afterFns[0]()).resolves.toBeUndefined();
  });
});
