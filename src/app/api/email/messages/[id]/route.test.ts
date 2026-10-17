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
vi.mock("@/lib/email/postmark-api", () => ({ getMessage: vi.fn() }));

import { GET } from "./route";
import { getMessage } from "@/lib/email/postmark-api";

const call = () => GET(new NextRequest("http://x/api/email/messages/m1"), { params: Promise.resolve({ id: "m1" }) });

beforeEach(() => {
  s.perms = ["view_overview", "manage_email"];
  vi.mocked(getMessage).mockReset().mockResolvedValue({
    id: "m1", to: "pat@hope.org", subject: "Hi", metadata: {}, textBody: "secret body", htmlBody: "<p>secret body</p>",
    hasAttachments: false, events: [],
  });
});

describe("GET /api/email/messages/[id]", () => {
  it("is 401 without a session", async () => {
    s.perms = null;
    expect((await call()).status).toBe(401);
  });

  it("is admin-only: a viewer (view_overview only) gets 403 and Postmark is never called", async () => {
    s.perms = ["view_overview"];
    expect((await call()).status).toBe(403);
    expect(getMessage).not.toHaveBeenCalled();
  });

  it("returns the details without the bodies for manage_email", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toMatchObject({ id: "m1", subject: "Hi" });
    expect(JSON.stringify(b)).not.toContain("secret body");
  });

  it("is 404 when Postmark has no such message", async () => {
    vi.mocked(getMessage).mockRejectedValue(new EmailError("send_failed", "nope", 404));
    expect((await call()).status).toBe(404);
  });
});
