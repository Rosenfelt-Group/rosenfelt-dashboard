import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { EmailError } from "@/lib/email/gmail";

const s = vi.hoisted(() => ({ perms: [] as string[] }));

vi.mock("@/lib/requirePermission", () => ({
  requirePermission: async (_req: unknown, permission: string) =>
    s.perms.includes(permission)
      ? { ok: true, username: "brian", role: "admin" }
      : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
}));
vi.mock("@/lib/email/postmark-api", () => ({ listSuppressions: vi.fn(), suppress: vi.fn(), unsuppress: vi.fn() }));
vi.mock("@/lib/email/events", () => ({ resolveEvents: vi.fn(), logAction: vi.fn() }));

import { GET, POST, DELETE } from "./route";
import { listSuppressions, suppress, unsuppress } from "@/lib/email/postmark-api";
import { resolveEvents, logAction } from "@/lib/email/events";

const req = (method: string, body?: unknown) =>
  new NextRequest("http://x/api/email/suppressions", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const sup = (email: string, reason: "HardBounce" | "SpamComplaint" | "ManualSuppression") =>
  ({ email, reason, origin: "Recipient", createdAt: "2026-10-01T00:00:00Z" });

beforeEach(() => {
  s.perms = ["view_overview", "manage_email"];
  vi.mocked(listSuppressions).mockReset().mockResolvedValue([sup("a@b.co", "HardBounce"), sup("spam@b.co", "SpamComplaint")]);
  vi.mocked(suppress).mockReset().mockResolvedValue();
  vi.mocked(unsuppress).mockReset().mockResolvedValue();
  vi.mocked(resolveEvents).mockReset().mockResolvedValue(2);
  vi.mocked(logAction).mockReset().mockResolvedValue();
});

describe("GET /api/email/suppressions", () => {
  it("adds canUnblock, false only for spam complaints", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).map((x: { canUnblock: boolean }) => x.canUnblock)).toEqual([true, false]);
  });
  it("maps a Postmark outage to 502 and missing config to 503", async () => {
    vi.mocked(listSuppressions).mockRejectedValueOnce(new EmailError("send_failed", "boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET(req("GET"))).status).toBe(502);
    vi.mocked(listSuppressions).mockRejectedValueOnce(new EmailError("not_configured", "x"));
    expect((await GET(req("GET"))).status).toBe(503);
    vi.mocked(listSuppressions).mockRejectedValueOnce(new EmailError("auth_failed", "x"));
    expect((await GET(req("GET"))).status).toBe(502);
  });
});

describe("viewer (no manage_email)", () => {
  beforeEach(() => { s.perms = ["view_overview"]; });
  it("gets 403 on POST and DELETE and nothing reaches Postmark", async () => {
    expect((await POST(req("POST", { email: "a@b.co" }))).status).toBe(403);
    expect((await DELETE(req("DELETE", { email: "a@b.co" }))).status).toBe(403);
    expect(suppress).not.toHaveBeenCalled();
    expect(listSuppressions).not.toHaveBeenCalled();
    expect(unsuppress).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/suppressions", () => {
  it("blocks and logs", async () => {
    const res = await POST(req("POST", { email: "new@b.co" }));
    expect(res.status).toBe(200);
    expect(suppress).toHaveBeenCalledWith("new@b.co");
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "block", recipient: "new@b.co", by: "brian" }));
  });
  it("400 on an invalid or missing email", async () => {
    expect((await POST(req("POST", { email: "nope" }))).status).toBe(400);
    expect((await POST(req("POST", {}))).status).toBe(400);
    expect(suppress).not.toHaveBeenCalled();
  });
  it("502 when Postmark fails, and nothing is logged", async () => {
    vi.mocked(suppress).mockRejectedValueOnce(new EmailError("auth_failed", "x"));
    expect((await POST(req("POST", { email: "new@b.co" }))).status).toBe(502);
    expect(logAction).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/email/suppressions", () => {
  it("409s a spam complaint without calling unsuppress", async () => {
    const res = await DELETE(req("DELETE", { email: "spam@b.co" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Blocked permanently — this person marked us as spam.");
    expect(unsuppress).not.toHaveBeenCalled();
    expect(resolveEvents).not.toHaveBeenCalled();
  });
  it("unblocks a hard bounce, resolves its events and logs", async () => {
    const res = await DELETE(req("DELETE", { email: "a@b.co" }));
    expect(res.status).toBe(200);
    expect(unsuppress).toHaveBeenCalledWith("a@b.co");
    expect(resolveEvents).toHaveBeenCalledWith({ recipient: "a@b.co" }, "unblocked", "brian");
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "unblock", recipient: "a@b.co", by: "brian" }));
  });
  it("404 when the address isn't suppressed", async () => {
    expect((await DELETE(req("DELETE", { email: "zzz@b.co" }))).status).toBe(404);
    expect(unsuppress).not.toHaveBeenCalled();
  });
  it("400 on an invalid email", async () => {
    expect((await DELETE(req("DELETE", { email: "nope" }))).status).toBe(400);
    expect(listSuppressions).not.toHaveBeenCalled();
  });
});
