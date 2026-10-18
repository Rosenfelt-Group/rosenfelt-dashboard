import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const s = vi.hoisted(() => ({ perms: [] as string[] }));

vi.mock("@/lib/requirePermission", () => ({
  requirePermission: async (_req: unknown, permission: string) =>
    s.perms.includes(permission)
      ? { ok: true, username: "brian", role: "admin" }
      : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
}));
vi.mock("@/lib/email/events", () => ({ resolveEvents: vi.fn(), logAction: vi.fn() }));

import { POST } from "./route";
import { resolveEvents, logAction } from "@/lib/email/events";

const ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";
const call = (id: string) =>
  POST(new NextRequest(`http://x/api/email/events/${id}/dismiss`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  s.perms = ["view_overview", "manage_email"];
  vi.mocked(resolveEvents).mockReset().mockResolvedValue(1);
  vi.mocked(logAction).mockReset().mockResolvedValue();
});

describe("POST /api/email/events/[id]/dismiss", () => {
  it("403 for a viewer and touches nothing", async () => {
    s.perms = ["view_overview"];
    expect((await call(ID)).status).toBe(403);
    expect(resolveEvents).not.toHaveBeenCalled();
  });
  it("400 for a non-UUID id", async () => {
    expect((await call("abc")).status).toBe(400);
    expect(resolveEvents).not.toHaveBeenCalled();
  });
  it("dismisses and logs", async () => {
    expect((await call(ID)).status).toBe(200);
    expect(resolveEvents).toHaveBeenCalledWith({ id: ID }, "dismissed", "brian");
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "dismiss", eventId: ID, by: "brian" }));
  });
  it("404 when nothing matched, and nothing is logged", async () => {
    vi.mocked(resolveEvents).mockResolvedValueOnce(0);
    expect((await call(ID)).status).toBe(404);
    expect(logAction).not.toHaveBeenCalled();
  });
});
