import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ session: null as { username: string; role: string; permissions: string[] } | null, sent: [] as unknown[] }));
vi.mock("@/lib/session", () => ({ COOKIE_NAME: "dashboard_session", verifySessionToken: vi.fn(async () => s.session) }));
vi.mock("@/lib/email/executor", () => ({
  sendEmail: vi.fn(async (input: unknown, source: string) => { s.sent.push({ input, source }); return { gmail_message_id: "g1", thread_id: "t1" }; }),
}));
import { POST } from "./route";

const req = (body: unknown, cookie = true) =>
  new NextRequest("http://x/api/crm/email/send", { method: "POST", body: JSON.stringify(body), headers: cookie ? { cookie: "dashboard_session=t" } : {} });
const ok = { to: ["a@x.org"], subject: "S", body_text: "B" };
beforeEach(() => { s.session = null; s.sent = []; });

describe("POST /api/crm/email/send", () => {
  it("compose_requires_admin", async () => {
    expect((await POST(req(ok, false))).status).toBe(401);
    s.session = { username: "v", role: "viewer", permissions: ["manage_crm", "manage_approvals"] };
    expect((await POST(req(ok))).status).toBe(403);
    expect(s.sent).toHaveLength(0);
  });
  it("sends as compose and returns ids", async () => {
    s.session = { username: "brian", role: "admin", permissions: [] };
    const res = await POST(req(ok));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gmail_message_id: "g1", thread_id: "t1" });
    expect((s.sent[0] as { source: string }).source).toBe("compose");
  });
  it("validates the body", async () => {
    s.session = { username: "brian", role: "admin", permissions: [] };
    for (const bad of [{ ...ok, to: [] }, { ...ok, to: ["nope"] }, { ...ok, subject: "" }, { ...ok, body_text: "x".repeat(50_001) }, { ...ok, reply_to_email_message_id: "z" }, { ...ok, cc: Array(11).fill("c@x.org") }]) {
      expect((await POST(req(bad))).status).toBe(400);
    }
    expect(s.sent).toHaveLength(0);
  });
});
