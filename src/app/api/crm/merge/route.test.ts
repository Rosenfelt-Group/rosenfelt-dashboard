import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const state = { rpc: vi.fn() };
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { schema: () => ({ rpc: (...a: unknown[]) => state.rpc(...a) }) },
}));

import { POST } from "./route";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  state.rpc = vi.fn().mockResolvedValue({ data: { kind: "lead", kept_id: A, merged_id: B, moved: {}, note_activity_id: "n" }, error: null });
});

describe("POST /api/crm/merge", () => {
  it("calls the kind's merge function with the session user", async () => {
    const res = await POST(req({ kind: "lead", keep_id: A, merge_id: B, fields: { stage: "merge" } }));
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("merge_leads", { p_keep: A, p_merge: B, p_fields: { stage: "merge" }, p_by: "brian" });
  });

  it("defaults fields to {} and maps businesses", async () => {
    await POST(req({ kind: "business", keep_id: A, merge_id: B }));
    expect(state.rpc).toHaveBeenCalledWith("merge_businesses", expect.objectContaining({ p_fields: {} }));
  });

  it("rejects bad input without calling the database", async () => {
    const res = await POST(req({ kind: "lead", keep_id: A, merge_id: A }));
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("maps merge errors", async () => {
    state.rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "MG003", message: "merge: a record in Trash" } });
    const res = await POST(req({ kind: "contact", keep_id: A, merge_id: B }));
    expect(res.status).toBe(409);
  });
});
