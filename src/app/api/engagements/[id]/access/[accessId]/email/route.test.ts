import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hashToken, roomLink } from "@/lib/rooms/token";

const s = vi.hoisted(() => ({
  access: null as Record<string, unknown> | null,
  eng: null as Record<string, unknown> | null,
  insert: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => {
  const query = (table: string) => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({
        data: table === "engagement_access" ? s.access : table === "engagements" ? s.eng : { name: "Hope Food Pantry" },
        error: null,
      }),
      insert: (row: unknown) => ({ then: (cb: (r: { error: null }) => void) => { s.insert(table, row); cb({ error: null }); } }),
    };
    return q;
  };
  return { supabaseAdmin: { schema: () => ({ from: query }) } };
});
vi.mock("@/lib/rooms/session-user", () => ({ sessionUsername: async () => "brian" }));
vi.mock("@/lib/email/gmail", async (orig) => {
  const real = await orig<typeof import("@/lib/email/gmail")>();
  return { ...real, sendEmail: s.send };
});
import { POST } from "./route";
import { EmailError } from "@/lib/email/gmail";

const ENG = "11111111-1111-4111-8111-111111111111";
const ACC = "22222222-2222-4222-8222-222222222222";
const LEAD = "44444444-4444-4444-8444-444444444444";
const TOKEN = "A".repeat(43);
const LINK = roomLink(TOKEN);

const call = (body: unknown, id = ENG, accessId = ACC) =>
  POST(new NextRequest(`https://d.test/api/engagements/${id}/access/${accessId}/email`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id, accessId }) });

beforeEach(() => {
  s.access = { id: ACC, token_hash: hashToken(TOKEN), expires_at: new Date(Date.now() + 86_400_000 * 30).toISOString(), revoked_at: null };
  s.eng = { id: ENG, title: "Website refresh", status: "active", business_id: "b", lead_id: LEAD };
  s.insert.mockReset();
  s.send.mockReset();
  s.send.mockResolvedValue({ id: "gm-1" });
});

describe("POST email room invite", () => {
  it("sends the invite to the recipient and logs it on the lead without the link", async () => {
    const r = await call({ to: "pat@hope.org", link: LINK, first_name: "Pat" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: "gm-1", logged: true });
    const msg = s.send.mock.calls[0][0];
    expect(msg.to).toBe("pat@hope.org");
    expect(msg.subject).toContain("Website refresh");
    expect(msg.text).toContain("Hi Pat,");
    expect(msg.text).toContain(LINK);
    expect(msg.text).toContain("Hope Food Pantry");
    const [table, row] = s.insert.mock.calls[0];
    expect(table).toBe("lead_activities");
    expect(row).toMatchObject({ lead_id: LEAD, activity_type: "system", metadata: { gmail_message_id: "gm-1" } });
    expect(JSON.stringify(row)).not.toContain(TOKEN);
  });

  it("skips logging when the room has no lead", async () => {
    s.eng = { ...s.eng, lead_id: null };
    const r = await call({ to: "pat@hope.org", link: LINK });
    expect(await r.json()).toMatchObject({ logged: false });
    expect(s.insert).not.toHaveBeenCalled();
  });

  it("refuses links that aren't this access row's live token", async () => {
    expect((await call({ to: "pat@hope.org", link: "https://evil.test/r/" + TOKEN })).status).toBe(400);
    expect((await call({ to: "pat@hope.org", link: roomLink("B".repeat(43)) })).status).toBe(404);
    s.access = { ...s.access, revoked_at: new Date().toISOString() };
    expect((await call({ to: "pat@hope.org", link: LINK })).status).toBe(409);
    expect(s.send).not.toHaveBeenCalled();
  });

  it("rejects bad ids and addresses without sending", async () => {
    expect((await call({ to: "pat@hope.org", link: LINK }, "x")).status).toBe(400);
    expect((await call({ to: "nope", link: LINK })).status).toBe(400);
    expect((await call({ to: "a@b.org\r\nBcc: c@d.org", link: LINK })).status).toBe(400);
    expect(s.send).not.toHaveBeenCalled();
  });

  it("maps mail failures to 503/502 and logs nothing", async () => {
    s.send.mockRejectedValueOnce(new EmailError("not_configured", "x"));
    expect((await call({ to: "pat@hope.org", link: LINK })).status).toBe(503);
    s.send.mockRejectedValueOnce(new EmailError("send_failed", "secret detail", 500));
    const r = await call({ to: "pat@hope.org", link: LINK });
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
    expect(s.insert).not.toHaveBeenCalled();
  });
});
