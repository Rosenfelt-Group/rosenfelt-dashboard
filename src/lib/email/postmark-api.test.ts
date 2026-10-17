import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getOutboundStats, listSuppressions, suppress, unsuppress, searchMessages, getMessage } from "./postmark-api";

const fetchMock = vi.fn();
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
};

beforeEach(() => {
  vi.stubEnv("POSTMARK_SERVER_TOKEN", "pm-token");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("auth and errors", () => {
  it("throws not_configured without a token", async () => {
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    await expect(getOutboundStats("2026-10-10", "2026-10-17")).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("maps 401 to auth_failed", async () => {
    fetchMock.mockResolvedValueOnce(json({ ErrorCode: 10, Message: "bad token" }, 401));
    await expect(listSuppressions()).rejects.toMatchObject({ code: "auth_failed", status: 401 });
  });
  it("maps other failures to send_failed with status", async () => {
    fetchMock.mockResolvedValueOnce(json({ ErrorCode: 500, Message: "boom" }, 500));
    await expect(getMessage("abc")).rejects.toMatchObject({ code: "send_failed", status: 500 });
  });
});

describe("timeout and network failures", () => {
  it("sends an abort signal and maps a failed or timed-out fetch to send_failed", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"));
    await expect(getOutboundStats("2026-10-10", "2026-10-17")).rejects.toMatchObject({ code: "send_failed" });
    expect((call().init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("unreadable 2xx body", () => {
  it("rejects with send_failed when json() fails on a successful response", async () => {
    const res = new Response("not json", { status: 200 });
    fetchMock.mockResolvedValueOnce(res);
    await expect(getOutboundStats("2026-10-10", "2026-10-17")).rejects.toMatchObject({ code: "send_failed" });
  });
});

describe("getOutboundStats", () => {
  it("maps stats and sends the token", async () => {
    fetchMock.mockResolvedValueOnce(json({ Sent: 38, Bounced: 1, SpamComplaints: 0 }));
    await expect(getOutboundStats("2026-10-10", "2026-10-17")).resolves.toEqual({ sent: 38, bounced: 1, spamComplaints: 0 });
    const { url, init } = call();
    expect(url).toContain("https://api.postmarkapp.com/stats/outbound?");
    expect(url).toContain("messagestream=outbound&fromdate=2026-10-10&todate=2026-10-17");
    expect(init.headers).toMatchObject({ "x-postmark-server-token": "pm-token" });
  });
  it("adds the tag filter", async () => {
    fetchMock.mockResolvedValueOnce(json({ Sent: 1, Bounced: 0, SpamComplaints: 0 }));
    await getOutboundStats("2026-10-10", "2026-10-17", "dashboard-room-invite");
    expect(call().url).toContain("tag=dashboard-room-invite");
  });
});

describe("suppressions", () => {
  it("lists and maps the dump", async () => {
    fetchMock.mockResolvedValueOnce(json({ Suppressions: [
      { EmailAddress: "a@b.co", SuppressionReason: "HardBounce", Origin: "Recipient", CreatedAt: "2026-10-16T10:00:00Z" },
    ] }));
    await expect(listSuppressions()).resolves.toEqual([
      { email: "a@b.co", reason: "HardBounce", origin: "Recipient", createdAt: "2026-10-16T10:00:00Z" },
    ]);
    expect(call().url).toBe("https://api.postmarkapp.com/message-streams/outbound/suppressions/dump");
  });
  it("suppress posts the address and checks Status", async () => {
    fetchMock.mockResolvedValueOnce(json({ Suppressions: [{ EmailAddress: "a@b.co", Status: "Suppressed", Message: null }] }));
    await expect(suppress("a@b.co")).resolves.toBeUndefined();
    const c = call();
    expect(c.url).toBe("https://api.postmarkapp.com/message-streams/outbound/suppressions");
    expect(c.init.method).toBe("POST");
    expect(c.body).toEqual({ Suppressions: [{ EmailAddress: "a@b.co" }] });
  });
  it("unsuppress posts to /delete", async () => {
    fetchMock.mockResolvedValueOnce(json({ Suppressions: [{ EmailAddress: "a@b.co", Status: "Deleted", Message: null }] }));
    await unsuppress("a@b.co");
    const c = call();
    expect(c.url).toBe("https://api.postmarkapp.com/message-streams/outbound/suppressions/delete");
    expect(c.body).toEqual({ Suppressions: [{ EmailAddress: "a@b.co" }] });
  });
  it("throws send_failed when the per-address Status is a failure", async () => {
    fetchMock.mockResolvedValueOnce(json({ Suppressions: [{ EmailAddress: "a@b.co", Status: "Failed", Message: "Cannot delete spam complaint" }] }));
    await expect(unsuppress("a@b.co")).rejects.toMatchObject({ code: "send_failed", message: expect.stringContaining("Cannot delete") });
  });
});

describe("messages", () => {
  it("searches by recipient", async () => {
    fetchMock.mockResolvedValueOnce(json({ TotalCount: 1, Messages: [
      { MessageID: "m1", To: [{ Email: "a@b.co", Name: null }], Subject: "Hi", Status: "Sent", Tag: "t", ReceivedAt: "2026-10-16T10:00:00Z" },
    ] }));
    const r = await searchMessages("a@b.co", 5);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "m1", to: "a@b.co", subject: "Hi", tag: "t", status: "Sent", receivedAt: "2026-10-16T10:00:00Z" });
    const u = call().url;
    expect(u).toContain("/messages/outbound?");
    expect(u).toContain("recipient=a%40b.co");
    expect(u).toContain("count=5");
    expect(u).toContain("offset=0");
  });
  it("maps message details", async () => {
    fetchMock.mockResolvedValueOnce(json({
      MessageID: "m1", To: [{ Email: "a@b.co" }], Subject: "Hi", Tag: "t", Metadata: { k: "v" },
      TextBody: "plain", HtmlBody: "<p>x</p>", Attachments: [{ Name: "f.pdf" }],
      MessageEvents: [{ Type: "Bounced", ReceivedAt: "2026-10-16T10:01:00Z", Details: { Summary: "mailbox full" } },
        { Type: "Delivered", ReceivedAt: "2026-10-16T10:00:30Z", Details: {} }],
    }));
    const m = await getMessage("m1");
    expect(m).toEqual({
      id: "m1", to: "a@b.co", subject: "Hi", tag: "t", metadata: { k: "v" }, textBody: "plain", htmlBody: "<p>x</p>",
      hasAttachments: true,
      events: [{ type: "Bounced", at: "2026-10-16T10:01:00Z", detail: "mailbox full" }, { type: "Delivered", at: "2026-10-16T10:00:30Z" }],
    });
    expect(call().url).toBe("https://api.postmarkapp.com/messages/outbound/m1/details");
  });
  it("hasAttachments is false when none", async () => {
    fetchMock.mockResolvedValueOnce(json({ MessageID: "m2", To: [{ Email: "a@b.co" }], Subject: "s", Attachments: [], MessageEvents: [] }));
    const m = await getMessage("m2");
    expect(m.hasAttachments).toBe(false);
    expect(m.metadata).toEqual({});
  });
});
