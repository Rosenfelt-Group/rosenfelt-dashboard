import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/requirePermission", () => ({ requirePermission: vi.fn(async () => ({ ok: true, session: { username: "brian" } })) }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: () => ({ insert: async () => ({}) }) } }));
import { POST } from "./route";

describe("POST /api/chat", () => {
  it("chat_rejects_casey: Casey is a prototype builder with no chat", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(new NextRequest("http://x/api/chat", { method: "POST", body: JSON.stringify({ message: "hi", agent: "casey" }) }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
