import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  finalize: vi.fn(),
  sendEmail: vi.fn(),
  configured: true,
}));

vi.mock("@/lib/discovery/send", () => ({ finalizeSend: s.finalize }));

vi.mock("@/lib/email", async (orig) => {
  const real = await orig<typeof import("@/lib/email")>();
  return { ...real, sendEmail: s.sendEmail, isEmailConfigured: () => s.configured };
});

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: s.invite, error: null });
        b.insert = (row: Record<string, unknown>) => {
          s.inserts.push({ table, row });
          return Promise.resolve({ error: null });
        };
        return b;
      },
    }),
  },
}));

import { POST as send } from "./route";
import { POST as resend } from "../email/route";
import { EmailError } from "@/lib/email";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (body: unknown) => new NextRequest(`http://x/api/crm/discovery/${ID}/send`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  s.inserts = [];
  s.configured = true;
  s.finalize.mockReset().mockResolvedValue({ ok: true, inviteId: ID, token: "tok", link: "https://rosably.com/discovery/?t=tok", leadId: "lead1" });
  s.sendEmail.mockReset().mockResolvedValue({ id: "gm1" });
  s.invite = {
    id: ID, token: "tok", lead_id: "lead1", status: "sent", project_title: "Intake",
    questionnaire_snapshot: { version: "v", title: "t", sections: [], estimated_minutes: 12 },
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), business: { name: "Acme" },
  };
});

describe("POST /api/crm/discovery/:id/send", () => {
  it("only freezes when no email is requested", async () => {
    const res = await send(req({}), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, link: "https://rosably.com/discovery/?t=tok" });
    expect(s.finalize).toHaveBeenCalledWith(ID);
    expect(s.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid recipient before freezing", async () => {
    const res = await send(req({ email: { to: "not-an-address" } }), ctx);
    expect(res.status).toBe(400);
    expect(s.finalize).not.toHaveBeenCalled();
    expect(s.sendEmail).not.toHaveBeenCalled();
  });

  it("emails the same invite text after freezing and logs it", async () => {
    const res = await send(req({ email: { to: "pat@example.org", firstName: "Pat" } }), ctx);
    expect(await res.json()).toMatchObject({ ok: true, email: { sent: true, id: "gm1" } });
    const msg = s.sendEmail.mock.calls[0][0];
    expect(msg).toMatchObject({ to: "pat@example.org", fromName: "Brian Rosenfelt", replyTo: "brian@rosably.com" });
    expect(msg.subject).toContain("Intake");
    expect(msg.text).toMatch(/^Hi Pat,/);
    expect(msg.text).toContain("https://rosably.com/discovery/?t=tok");
    expect(msg.text).toContain("about 12 minutes");
    expect(s.inserts[0].row).toMatchObject({ activity_type: "email_sent", metadata: { discovery_invite_id: ID, gmail_message_id: "gm1" } });
  });

  it("stays sent when the email fails, and reports a safe error", async () => {
    s.sendEmail.mockRejectedValue(new EmailError("send_failed", "Google said: secret detail"));
    const res = await send(req({ email: { to: "pat@example.org" } }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.link).toBeTruthy();
    expect(body.email.sent).toBe(false);
    expect(body.email.error).not.toContain("secret");
    expect(s.inserts[0].row).toMatchObject({ activity_type: "system", metadata: { discovery_invite_id: ID, gmail_message_id: null } });
  });

  it("reports email not configured without failing the send", async () => {
    s.configured = false;
    const body = await (await send(req({ email: { to: "pat@example.org" } }), ctx)).json();
    expect(body).toMatchObject({ ok: true, email: { sent: false } });
    expect(s.sendEmail).not.toHaveBeenCalled();
  });

  it("passes freeze errors through and sends nothing", async () => {
    s.finalize.mockResolvedValue({ ok: false, status: 409, error: "This questionnaire has already been sent." });
    const res = await send(req({ email: { to: "pat@example.org" } }), ctx);
    expect(res.status).toBe(409);
    expect(s.sendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/crm/discovery/:id/email (resend)", () => {
  it("resends for an open invite without freezing", async () => {
    const res = await resend(req({ to: "pat@example.org" }), ctx);
    expect(res.status).toBe(200);
    expect(s.finalize).not.toHaveBeenCalled();
    expect(s.sendEmail).toHaveBeenCalledOnce();
    expect(s.sendEmail.mock.calls[0][0].text).toMatch(/^Hi there,/);
  });

  it("refuses drafts, submitted and expired invites", async () => {
    for (const patch of [{ status: "draft" }, { status: "submitted" }, { expires_at: new Date(Date.now() - 1000).toISOString() }]) {
      s.invite = { ...s.invite!, status: "sent", ...patch };
      const res = await resend(req({ to: "pat@example.org" }), ctx);
      expect(res.status).toBe(409);
    }
    expect(s.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid recipient", async () => {
    expect((await resend(req({ to: "x" }), ctx)).status).toBe(400);
  });
});
