import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown> | null>,
  updates: [] as { table: string; row: unknown; eq: unknown[] }[],
}));

// Minimal PostgREST chain: maybeSingle() returns s.rows[table]; update(...).eq(...) is recorded.
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({ data: s.rows[table] ?? null, error: null }),
          update: (row: unknown) => ({
            eq: async (...eq: unknown[]) => { s.updates.push({ table, row, eq }); return { error: null }; },
          }),
        };
        return b;
      },
    }),
  },
}));
vi.mock("@/lib/email", async (orig) => {
  const real = await orig<typeof import("@/lib/email")>();
  return { ...real, sendEmail: vi.fn(), emailProvider: vi.fn() };
});
vi.mock("@/lib/email/postmark-api", () => ({ listSuppressions: vi.fn(), unsuppress: vi.fn(), getMessage: vi.fn() }));
vi.mock("@/lib/email/events", () => ({ getEvent: vi.fn(), resolveEvents: vi.fn(), logAction: vi.fn() }));
vi.mock("@/lib/rooms/refresh-access", () => ({ refreshAccess: vi.fn() }));
vi.mock("@/lib/rooms/send-invite", () => ({ sendRoomInvite: vi.fn() }));
vi.mock("@/lib/discovery/email", () => ({ emailInvite: vi.fn() }));

import { resendEvent } from "./resend";
import { sendEmail, emailProvider } from "@/lib/email";
import { listSuppressions, unsuppress, getMessage } from "@/lib/email/postmark-api";
import { getEvent, resolveEvents, logAction, type EmailEvent } from "@/lib/email/events";
import { refreshAccess } from "@/lib/rooms/refresh-access";
import { sendRoomInvite } from "@/lib/rooms/send-invite";
import { emailInvite } from "@/lib/discovery/email";

const EV = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";
const ENG = "11111111-1111-4111-8111-111111111111";
const ACC = "22222222-2222-4222-8222-222222222222";
const NEW_ACC = "33333333-3333-4333-8333-333333333333";
const LEAD = "44444444-4444-4444-8444-444444444444";
const CONTACT = "55555555-5555-4555-8555-555555555555";
const INV = "66666666-6666-4666-8666-666666666666";
const NEW_LINK = "https://portal.rosably.com/r/" + "N".repeat(43);

function event(over: Partial<EmailEvent> = {}): EmailEvent {
  return {
    id: EV, event_key: "k", record_type: "Bounce", message_id: "pm-old", recipient: "pat@hope.org",
    subject: "Hello", tag: "n8n-stripe-buyer", source_group: "n8n", bounce_type: "HardBounce",
    description: null, inactive: true, can_activate: true, metadata: {}, occurred_at: "2026-10-16T00:00:00Z",
    received_at: "2026-10-16T00:00:00Z", payload: {}, resolved_at: null, resolved_by: null, resolution: null,
    ...over,
  };
}

beforeEach(() => {
  s.rows = {};
  s.updates = [];
  vi.mocked(getEvent).mockReset().mockResolvedValue(event());
  vi.mocked(resolveEvents).mockReset().mockResolvedValue(1);
  vi.mocked(logAction).mockReset().mockResolvedValue();
  vi.mocked(emailProvider).mockReset().mockReturnValue("postmark");
  vi.mocked(sendEmail).mockReset().mockResolvedValue({ id: "pm-new" });
  vi.mocked(listSuppressions).mockReset().mockResolvedValue([]);
  vi.mocked(unsuppress).mockReset().mockResolvedValue();
  vi.mocked(getMessage).mockReset().mockResolvedValue({
    id: "pm-old", to: "pat@hope.org", subject: "Your receipt", tag: "n8n-stripe-buyer", metadata: {},
    textBody: "Thanks for buying", htmlBody: "<p>Thanks for buying</p>", hasAttachments: false, events: [],
  });
  vi.mocked(refreshAccess).mockReset().mockResolvedValue({ ok: true, accessId: NEW_ACC, link: NEW_LINK, expiresAt: "2026-12-16T00:00:00Z" });
  vi.mocked(sendRoomInvite).mockReset().mockResolvedValue({ ok: true, id: "pm-room", logged: true });
  vi.mocked(emailInvite).mockReset().mockResolvedValue({ sent: true, id: "pm-disc" });
});

const roomEvent = () => event({ tag: "dashboard-room-invite", source_group: "dashboard", metadata: { engagement_id: ENG, access_id: ACC } });
const discoveryEvent = () => event({ tag: "dashboard-discovery-invite", source_group: "dashboard", metadata: { discovery_invite_id: INV } });

describe("resendEvent — room invite", () => {
  it("closed room → 409, nothing sent, nothing resolved", async () => {
    vi.mocked(getEvent).mockResolvedValue(roomEvent());
    vi.mocked(refreshAccess).mockResolvedValue({
      ok: false, status: 409, error: "This link can't be refreshed: it was already revoked or the room is closed.",
    });
    const r = await resendEvent(EV, { by: "brian" });
    expect(r).toEqual({ ok: false, status: 409, error: "This link can't be refreshed: it was already revoked or the room is closed." });
    expect(sendRoomInvite).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(resolveEvents).not.toHaveBeenCalled();
  });

  it("refreshes the link, sends the new link as a refreshed invite, resolves the event", async () => {
    vi.mocked(getEvent).mockResolvedValue(roomEvent());
    s.rows = { engagements: { lead_id: LEAD }, leads: { contact_id: CONTACT }, contacts: { id: CONTACT, email: "pat@hope.org", first_name: "Pat" } };
    const r = await resendEvent(EV, { by: "brian" });
    expect(r).toEqual({ ok: true, messageId: "pm-room" });
    expect(refreshAccess).toHaveBeenCalledWith(ENG, ACC);
    expect(vi.mocked(refreshAccess).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sendRoomInvite).mock.invocationCallOrder[0]);
    expect(sendRoomInvite).toHaveBeenCalledWith(expect.objectContaining({
      engagementId: ENG, accessId: NEW_ACC, to: "pat@hope.org", link: NEW_LINK, firstName: "Pat", refreshed: true, by: "brian",
    }));
    expect(resolveEvents).toHaveBeenCalledWith({ id: EV }, "resent", "brian");
    const logged = vi.mocked(logAction).mock.calls.find(([a]) => a.action === "resend")![0];
    expect(logged).toMatchObject({ eventId: EV, detail: { from_tag: "dashboard-room-invite", to: "pat@hope.org", new_message_id: "pm-room" } });
    expect(JSON.stringify(logged)).not.toContain(NEW_LINK);
    expect(s.updates).toEqual([]);
  });

  it("missing room ids in metadata → 422 without refreshing", async () => {
    vi.mocked(getEvent).mockResolvedValue(event({ tag: "dashboard-room-invite", metadata: {} }));
    expect(await resendEvent(EV, { by: "brian" })).toMatchObject({ ok: false, status: 422 });
    expect(refreshAccess).not.toHaveBeenCalled();
  });
});

describe("resendEvent — discovery invite", () => {
  it("corrected address: sends there and saves it on the lead's contact", async () => {
    vi.mocked(getEvent).mockResolvedValue(discoveryEvent());
    s.rows = { discovery_invites: { lead_id: LEAD }, leads: { contact_id: CONTACT }, contacts: { id: CONTACT, email: "pat@hope.org", first_name: "Pat" } };
    const r = await resendEvent(EV, { to: "pat@hopefood.org", by: "brian" });
    expect(r).toEqual({ ok: true, messageId: "pm-disc", contactUpdated: true });
    expect(emailInvite).toHaveBeenCalledWith(INV, { to: "pat@hopefood.org", firstName: "Pat" });
    expect(s.updates).toEqual([{ table: "contacts", row: { email: "pat@hopefood.org" }, eq: ["id", CONTACT] }]);
    expect(resolveEvents).toHaveBeenCalledWith({ id: EV }, "resent", "brian");
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "resend", detail: expect.objectContaining({ to: "pat@hopefood.org", contactUpdated: true }),
    }));
  });

  it("corrected address with no contact on the lead → contactUpdated false", async () => {
    vi.mocked(getEvent).mockResolvedValue(discoveryEvent());
    s.rows = { discovery_invites: { lead_id: LEAD }, leads: { contact_id: null } };
    const r = await resendEvent(EV, { to: "pat@hopefood.org", by: "brian" });
    expect(r).toEqual({ ok: true, messageId: "pm-disc", contactUpdated: false });
    expect(s.updates).toEqual([]);
  });

  it("closed/expired questionnaire → its 409, contact untouched, nothing resolved", async () => {
    vi.mocked(getEvent).mockResolvedValue(discoveryEvent());
    s.rows = { discovery_invites: { lead_id: LEAD }, leads: { contact_id: CONTACT }, contacts: { id: CONTACT, email: "pat@hope.org", first_name: "Pat" } };
    vi.mocked(emailInvite).mockResolvedValue({ sent: false, status: 409, error: "Only an open, unexpired questionnaire can be emailed." });
    const r = await resendEvent(EV, { to: "pat@hopefood.org", by: "brian" });
    expect(r).toEqual({ ok: false, status: 409, error: "Only an open, unexpired questionnaire can be emailed." });
    expect(s.updates).toEqual([]);
    expect(resolveEvents).not.toHaveBeenCalled();
  });
});

describe("resendEvent — n8n customer email", () => {
  it("copies subject and body from Postmark, keeps the tag, sends as Brian", async () => {
    const r = await resendEvent(EV, { by: "brian" });
    expect(r).toEqual({ ok: true, messageId: "pm-new" });
    expect(getMessage).toHaveBeenCalledWith("pm-old");
    expect(sendEmail).toHaveBeenCalledWith({
      to: "pat@hope.org", subject: "Your receipt", text: "Thanks for buying", html: "<p>Thanks for buying</p>",
      tag: "n8n-stripe-buyer", fromName: "Brian Rosenfelt", replyTo: "brian@rosably.com",
    });
    expect(resolveEvents).toHaveBeenCalledWith({ id: EV }, "resent", "brian");
    expect(s.updates).toEqual([]);
  });

  it("message with an attachment → 422, nothing sent", async () => {
    vi.mocked(getMessage).mockResolvedValue({ id: "pm-old", to: "", subject: "x", metadata: {}, hasAttachments: true, events: [] });
    expect(await resendEvent(EV, { by: "brian" })).toMatchObject({ ok: false, status: 422 });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("resendEvent — refusals", () => {
  it("avery-deliver-audit → 422 with the n8n guidance", async () => {
    vi.mocked(getEvent).mockResolvedValue(event({ tag: "n8n-avery-deliver-audit" }));
    expect(await resendEvent(EV, { by: "brian" })).toEqual({
      ok: false, status: 422, error: "Re-run the delivery from n8n (avery-deliver-audit).",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each(["n8n-weekly-audit", "wordpress", null])("tag %s → 422 not resendable", async (tag) => {
    vi.mocked(getEvent).mockResolvedValue(event({ tag }));
    expect(await resendEvent(EV, { by: "brian" })).toEqual({
      ok: false, status: 422, error: "This email can't be resent from the dashboard.",
    });
  });

  it("Gmail provider → 503, nothing sent", async () => {
    vi.mocked(emailProvider).mockReturnValue("gmail");
    expect(await resendEvent(EV, { by: "brian" })).toMatchObject({ ok: false, status: 503 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(getMessage).not.toHaveBeenCalled();
  });

  it("spam-suppressed address → 409 permanent, even with unblock", async () => {
    vi.mocked(listSuppressions).mockResolvedValue([{ email: "PAT@hope.org", reason: "SpamComplaint", origin: "Recipient", createdAt: "" }]);
    const r = await resendEvent(EV, { unblock: true, by: "brian" });
    expect(r).toEqual({ ok: false, status: 409, error: "Blocked permanently — this person marked us as spam." });
    expect(unsuppress).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("hard-bounce suppressed without unblock → 409 still blocked; with unblock → unsuppress then send", async () => {
    vi.mocked(listSuppressions).mockResolvedValue([{ email: "pat@hope.org", reason: "HardBounce", origin: "Recipient", createdAt: "" }]);
    const blocked = await resendEvent(EV, { by: "brian" });
    expect(blocked).toMatchObject({ ok: false, status: 409 });
    expect((blocked as { error: string }).error).toMatch(/still blocked/i);
    expect(unsuppress).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();

    const r = await resendEvent(EV, { unblock: true, by: "brian" });
    expect(r).toEqual({ ok: true, messageId: "pm-new" });
    expect(unsuppress).toHaveBeenCalledWith("pat@hope.org");
    expect(vi.mocked(unsuppress).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sendEmail).mock.invocationCallOrder[0]);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "unblock", recipient: "pat@hope.org" }));
  });

  it("spam complaint event → 409 permanent", async () => {
    vi.mocked(getEvent).mockResolvedValue(event({ record_type: "SpamComplaint" }));
    expect(await resendEvent(EV, { by: "brian" })).toMatchObject({ ok: false, status: 409 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("unknown or already-resolved event → 404 / 409", async () => {
    vi.mocked(getEvent).mockResolvedValueOnce(null);
    expect(await resendEvent(EV, { by: "brian" })).toMatchObject({ ok: false, status: 404 });
    vi.mocked(getEvent).mockResolvedValueOnce(event({ resolved_at: "2026-10-17T00:00:00Z", resolution: "dismissed" }));
    expect(await resendEvent(EV, { by: "brian" })).toMatchObject({ ok: false, status: 409 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("invalid corrected address → 400", async () => {
    expect(await resendEvent(EV, { to: "nope", by: "brian" })).toMatchObject({ ok: false, status: 400 });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
