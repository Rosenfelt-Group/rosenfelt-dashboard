import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ session: null as { username: string; role: string; permissions: string[] } | null, out: { status: "done", gmail_message_id: "g1" } as { status: string } }));
vi.mock("@/lib/session", () => ({ COOKIE_NAME: "dashboard_session", verifySessionToken: vi.fn(async () => s.session) }));
const order = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/email/executor", () => ({
  executeApproval: vi.fn(async () => { order.push("execute"); return s.out; }),
  sweepStaleExecuting: vi.fn(async () => { order.push("sweep"); return 0; }),
}));
import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id = ID, cookie = true) => POST(new NextRequest("http://x", { method: "POST", headers: cookie ? { cookie: "dashboard_session=t" } : {} }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  order.length = 0; s.session = null; s.out = { status: "done" }; });

describe("POST /api/approvals/:id/execute", () => {
  it("requires manage_approvals", async () => {
    expect((await call(ID, false)).status).toBe(401);
    s.session = { username: "v", role: "viewer", permissions: ["view_crm"] };
    expect((await call()).status).toBe(403);
  });
  it("executes with the permission", async () => {
    s.session = { username: "v", role: "viewer", permissions: ["manage_approvals"] };
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("done");
  });
  it("returns 409 when skipped, 400 for a bad id", async () => {
    s.session = { username: "v", role: "viewer", permissions: ["manage_approvals"] };
    s.out = { status: "skipped" };
    expect((await call()).status).toBe(409);
    expect((await call("nope")).status).toBe(400);
  });
  it("sweeps stale executing rows before executing (R35)", async () => {
    s.session = { username: "v", role: "viewer", permissions: ["manage_approvals"] };
    await call();
    expect(order).toEqual(["sweep", "execute"]);
  });
});
