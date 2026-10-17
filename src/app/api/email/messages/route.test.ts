import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const s = vi.hoisted(() => ({ perms: [] as string[] | null }));

vi.mock("@/lib/requirePermission", () => ({
  requirePermission: async (_req: unknown, permission: string) =>
    s.perms === null
      ? { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
      : s.perms.includes(permission)
        ? { ok: true, username: "u", role: "x" }
        : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
}));
vi.mock("@/lib/email/postmark-api", () => ({ searchMessages: vi.fn() }));

import { GET } from "./route";
import { searchMessages } from "@/lib/email/postmark-api";

const req = (q = "recipient=pat%40hope.org") => new NextRequest(`http://x/api/email/messages?${q}`);
const summary = { id: "m1", to: "pat@hope.org", subject: "Hi", status: "Sent", receivedAt: "2026-10-16T00:00:00Z" };

beforeEach(() => {
  s.perms = ["view_overview", "manage_email"];
  vi.mocked(searchMessages).mockReset().mockResolvedValue([summary]);
});

describe("GET /api/email/messages", () => {
  it("is 401 without a session", async () => {
    s.perms = null;
    expect((await GET(req())).status).toBe(401);
  });

  it("is admin-only: a viewer (view_overview only) gets 403 and Postmark is never called", async () => {
    s.perms = ["view_overview"];
    expect((await GET(req())).status).toBe(403);
    expect(searchMessages).not.toHaveBeenCalled();
  });

  it("returns the recipient's messages for manage_email", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([summary]);
    expect(searchMessages).toHaveBeenCalledWith("pat@hope.org");
  });

  it("is 400 without a valid recipient", async () => {
    expect((await GET(req("recipient=nope"))).status).toBe(400);
  });
});
