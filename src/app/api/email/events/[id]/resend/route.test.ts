import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const s = vi.hoisted(() => ({ perms: [] as string[] }));

vi.mock("@/lib/requirePermission", () => ({
  requirePermission: async (_req: unknown, permission: string) =>
    s.perms.includes(permission)
      ? { ok: true, username: "brian", role: "admin" }
      : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
}));
vi.mock("@/lib/email/resend", () => ({ resendEvent: vi.fn() }));

import { POST } from "./route";
import { resendEvent } from "@/lib/email/resend";

const ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";
const call = (id: string, body?: unknown) =>
  POST(new NextRequest(`http://x/api/email/events/${id}/resend`, {
    method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  s.perms = ["view_overview", "manage_email"];
  vi.mocked(resendEvent).mockReset().mockResolvedValue({ ok: true, messageId: "pm-new" });
});

describe("POST /api/email/events/[id]/resend", () => {
  it("403 for a viewer and resends nothing", async () => {
    s.perms = ["view_overview"];
    expect((await call(ID, {})).status).toBe(403);
    expect(resendEvent).not.toHaveBeenCalled();
  });
  it("400 for a non-UUID id or a bad body", async () => {
    expect((await call("abc", {})).status).toBe(400);
    expect((await call(ID, { to: 5 })).status).toBe(400);
    expect((await call(ID, { unblock: "yes" })).status).toBe(400);
    expect(resendEvent).not.toHaveBeenCalled();
  });
  it("passes to/unblock and the admin's name; returns the result", async () => {
    const r = await call(ID, { to: "pat@hopefood.org", unblock: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, messageId: "pm-new" });
    expect(resendEvent).toHaveBeenCalledWith(ID, { to: "pat@hopefood.org", unblock: true, by: "brian" });
  });
  it("works with no body", async () => {
    expect((await call(ID)).status).toBe(200);
    expect(resendEvent).toHaveBeenCalledWith(ID, { by: "brian" });
  });
  it("returns a refusal with its status", async () => {
    vi.mocked(resendEvent).mockResolvedValueOnce({ ok: false, status: 422, error: "This email can't be resent from the dashboard." });
    const r = await call(ID, {});
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: "This email can't be resent from the dashboard." });
  });
  it("500 without detail when resend throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(resendEvent).mockRejectedValueOnce(new Error("secret detail"));
    const r = await call(ID, {});
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
    err.mockRestore();
  });
});
