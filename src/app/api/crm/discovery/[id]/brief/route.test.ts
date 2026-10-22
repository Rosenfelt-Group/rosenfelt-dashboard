import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  ops: [] as string[],
  updates: [] as { table: string; patch: Record<string, unknown>; eqs: [string, unknown][] }[],
  insertError: null as { message: string } | null,
  brief: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: s.invite, error: null });
        b.update = (patch: Record<string, unknown>) => {
          const eqs: [string, unknown][] = [];
          const u: Record<string, unknown> = {};
          u.eq = (k: string, v: unknown) => { eqs.push([k, v]); return u; };
          u.in = (k: string, v: unknown) => { eqs.push([k, v]); return u; };
          u.then = (res: (v: unknown) => unknown) => {
            s.updates.push({ table, patch, eqs });
            s.ops.push(`update:${String(patch.status)}`);
            return Promise.resolve({ error: null }).then(res);
          };
          return u;
        };
        b.insert = (row: Record<string, unknown>) => { s.ops.push(`insert:${String(row.status)}`); return Promise.resolve({ error: s.insertError }); };
        return b;
      },
    }),
  },
}));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/riley/discovery", async orig => ({ ...(await orig<typeof import("@/lib/riley/discovery")>()), requestBrief: (...a: unknown[]) => s.brief(...a) }));

import { POST } from "./route";
import { RileyNotConfiguredError } from "@/lib/riley/discovery";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const call = () => POST(new NextRequest(`http://x/api/crm/discovery/${ID}/brief`, { method: "POST" }), { params: Promise.resolve({ id: ID }) });
const OK = { status: "ready", brief_id: "b1", scope_version_id: "sv1", fit_verdict: "strong" };

beforeEach(() => {
  s.invite = { id: ID, status: "submitted" };
  s.ops = []; s.updates = []; s.insertError = null;
  s.brief = vi.fn().mockImplementation(async () => { s.ops.push("riley"); return { ok: true, data: OK }; });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST brief", () => {
  it("404s and 409s before touching briefs", async () => {
    s.invite = null;
    expect((await call()).status).toBe(404);
    s.invite = { id: ID, status: "sent" };
    expect((await call()).status).toBe(409);
    expect(s.ops).toEqual([]);
  });

  it("supersedes, inserts pending, then calls Riley and returns its result", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OK);
    expect(s.ops).toEqual(["update:superseded", "insert:pending", "riley"]);
    expect(s.brief).toHaveBeenCalledWith(ID);
  });

  it("returns a generic 502 when Riley fails and leaves the failed row to Riley", async () => {
    s.brief.mockResolvedValue({ ok: false, kind: "failed", status: 502 });
    const res = await call();
    expect(res.status).toBe(502);
    expect(s.updates.filter(u => u.patch.status === "failed")).toHaveLength(0);
  });

  it("marks the pending brief failed when Riley is unreachable", async () => {
    s.brief.mockResolvedValue({ ok: false, kind: "unreachable" });
    const res = await call();
    expect(res.status).toBe(502);
    const failed = s.updates.find(u => u.patch.status === "failed");
    expect(failed?.patch.error).toBe("Riley unreachable");
    expect(failed?.eqs).toContainEqual(["invite_id", ID]);
    expect(failed?.eqs).toContainEqual(["status", "pending"]);
  });

  it("503 when not configured, and the pending brief is failed", async () => {
    s.brief.mockRejectedValue(new RileyNotConfiguredError());
    expect((await call()).status).toBe(503);
    expect(s.updates.some(u => u.patch.status === "failed")).toBe(true);
  });

  it("500s if the pending insert fails and never calls Riley", async () => {
    s.insertError = { message: "boom" };
    expect((await call()).status).toBe(500);
    expect(s.brief).not.toHaveBeenCalled();
  });
});
