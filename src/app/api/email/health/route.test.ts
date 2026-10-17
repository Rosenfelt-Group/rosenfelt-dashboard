import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { EmailError } from "@/lib/email/gmail";

const s = vi.hoisted(() => ({ perms: [] as string[] | null }));

vi.mock("@/lib/requirePermission", () => ({
  requirePermission: async (_req: unknown, permission: string) =>
    s.perms === null
      ? { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
      : s.perms.includes(permission)
        ? { ok: true, username: "u", role: "x" }
        : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
}));
vi.mock("@/lib/email/postmark-api", () => ({
  KNOWN_TAGS: ["dashboard-discovery-invite", "dashboard-room-invite", "n8n-stripe-buyer", "wordpress"],
  getOutboundStats: vi.fn(),
}));
vi.mock("@/lib/email/events", () => ({ listProblems: vi.fn(), windowCounts: vi.fn() }));

import { GET } from "./route";
import { getOutboundStats } from "@/lib/email/postmark-api";
import { listProblems, windowCounts } from "@/lib/email/events";

const req = () => new NextRequest("http://x/api/email/health");
const event = { id: "e1", record_type: "Bounce", recipient: "a@b.co" };

beforeEach(() => {
  s.perms = ["view_overview"];
  vi.mocked(getOutboundStats).mockReset().mockImplementation(async (_f, _t, tag) =>
    tag === "wordpress" ? { sent: 4, bounced: 0, spamComplaints: 0 }
    : tag ? { sent: 10, bounced: 1, spamComplaints: 0 }
    : { sent: 34, bounced: 2, spamComplaints: 0 });
  vi.mocked(windowCounts).mockReset().mockResolvedValue({ delivered: 30, unresolvedHardBounces: 0, unresolvedSpam: 0, events: 40 });
  vi.mocked(listProblems).mockReset().mockResolvedValue([event] as never);
});

describe("GET /api/email/health", () => {
  it("is 401 without a session", async () => {
    s.perms = null;
    expect((await GET(req())).status).toBe(401);
  });

  it("returns health, 7-day window, sources grouped by prefix, and canManage false for a viewer", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.health.level).toBe("green");
    expect(b.canManage).toBe(false);
    expect(b.stats).toEqual({ sent: 34, bounced: 2, spamComplaints: 0 });
    expect(b.bySource).toEqual([
      { source: "dashboard", sent: 20, bounced: 2, spam: 0 },
      { source: "n8n", sent: 10, bounced: 1, spam: 0 },
      { source: "wordpress", sent: 4, bounced: 0, spam: 0 },
    ]);
    expect(b.lastProblem).toEqual(event);
    expect(b.window.from < b.window.to).toBe(true);
  });

  it("canManage is true with manage_email", async () => {
    s.perms = ["view_overview", "manage_email"];
    expect((await (await GET(req())).json()).canManage).toBe(true);
  });

  it("level comes from the rules (unresolved hard bounce is amber)", async () => {
    vi.mocked(windowCounts).mockResolvedValue({ delivered: 30, unresolvedHardBounces: 1, unresolvedSpam: 0, events: 40 });
    expect((await (await GET(req())).json()).health.level).toBe("amber");
  });

  it("Postmark auth failure is 200 with red health and no stats", async () => {
    vi.mocked(getOutboundStats).mockRejectedValue(new EmailError("auth_failed", "nope", 401));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.health.level).toBe("red");
    expect(b.stats).toBeNull();
    expect(b.bySource).toEqual([]);
  });

  it("other Postmark failures are red 'unreachable'", async () => {
    vi.mocked(getOutboundStats).mockRejectedValue(new EmailError("send_failed", "timeout"));
    const b = await (await GET(req())).json();
    expect(b.health.level).toBe("red");
    expect(b.health.reasons[0]).toMatch(/reach Postmark/);
  });
});
