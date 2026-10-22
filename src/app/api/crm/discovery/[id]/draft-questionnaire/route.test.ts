import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const s = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  allowed: true,
  draft: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: s.invite, error: null });
        return b;
      },
    }),
  },
}));
vi.mock("@/lib/requirePermission", () => ({
  requirePermission: async (_r: unknown, perm: string) =>
    s.allowed ? { ok: true, username: "brian", role: "admin", perm } : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
}));
vi.mock("@/lib/riley/client", async orig => ({ ...(await orig<typeof import("@/lib/riley/client")>()), draftQuestionnaire: (...a: unknown[]) => s.draft(...a) }));

import { POST, maxDuration } from "./route";
import { RileyNotConfiguredError } from "@/lib/riley/client";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const call = (id = ID) => POST(new NextRequest(`http://x/api/crm/discovery/${id}/draft-questionnaire`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  s.invite = { id: ID, status: "draft" };
  s.allowed = true;
  s.draft = vi.fn().mockResolvedValue({ ok: true, data: { sections: [{ id: "fit" }], added_custom: 3 } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST draft-questionnaire", () => {
  it("allows 300s", () => expect(maxDuration).toBe(300));
  it("is guarded", async () => {
    s.allowed = false;
    expect((await call()).status).toBe(403);
    expect(s.draft).not.toHaveBeenCalled();
  });
  it("404s on a non-uuid id and an unknown invite", async () => {
    expect((await call("nope")).status).toBe(404);
    s.invite = null;
    expect((await call()).status).toBe(404);
    expect(s.draft).not.toHaveBeenCalled();
  });
  it("409s when the invite is not a draft", async () => {
    s.invite = { id: ID, status: "sent" };
    expect((await call()).status).toBe(409);
    expect(s.draft).not.toHaveBeenCalled();
  });
  it("passes Riley's result through", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sections: [{ id: "fit" }], added_custom: 3 });
    expect(s.draft).toHaveBeenCalledWith(ID);
  });
  it("gives a generic 502 on Riley failure without leaking text", async () => {
    s.draft.mockResolvedValue({ ok: false, kind: "failed", status: 500 });
    const res = await call();
    expect(res.status).toBe(502);
    expect(typeof (await res.json()).error).toBe("string");
  });
  it("maps unreachable to 502, conflict to 409, not configured to 503", async () => {
    s.draft.mockResolvedValue({ ok: false, kind: "unreachable" });
    expect((await call()).status).toBe(502);
    s.draft.mockResolvedValue({ ok: false, kind: "conflict", status: 409 });
    expect((await call()).status).toBe(409);
    s.draft.mockRejectedValue(new RileyNotConfiguredError());
    expect((await call()).status).toBe(503);
  });
});
