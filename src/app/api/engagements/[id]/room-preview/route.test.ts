import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { verifyPreviewToken } from "@/lib/rooms/grant";

const s = vi.hoisted(() => ({ eng: { data: null as unknown, error: null as unknown } }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { schema: () => ({ from: () => { const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => s.eng; return b; } }) },
}));
import { POST } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const SECRET = "s".repeat(32);
const call = (id = ENG) => POST(new NextRequest(`https://d.test/api/engagements/${id}/room-preview`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.ROOM_GRANT_SECRET = SECRET;
  process.env.NEXT_PUBLIC_PORTAL_URL = "https://portal.test";
  s.eng = { data: { id: ENG }, error: null };
});

describe("POST engagements/[id]/room-preview", () => {
  it("returns a portal /preview URL with a 5-minute token bound to the engagement", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(url.startsWith("https://portal.test/preview/p1.")).toBe(true);
    expect(verifyPreviewToken(url.split("/preview/")[1], SECRET)).toMatchObject({ ok: true, eid: ENG });
  });
  it("404s an unknown engagement, 400s a bad id, 500s without the secret", async () => {
    s.eng = { data: null, error: null };
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(400);
    s.eng = { data: { id: ENG }, error: null };
    delete process.env.ROOM_GRANT_SECRET;
    expect((await call()).status).toBe(500);
  });
  it("returns a fixed 500 (not 404) on a database error, without leaking its text", async () => {
    s.eng = { data: null, error: { message: "secret_table exploded" } };
    const r = await call();
    expect(r.status).toBe(500);
    const body = JSON.stringify(await r.json());
    expect(body).toContain("Could not create the preview link.");
    expect(body).not.toContain("secret_table");
  });
  it("sends Cache-Control private, no-store and rejects an uppercase UUID", async () => {
    expect((await call()).headers.get("cache-control")).toBe("private, no-store");
    expect((await call("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).status).toBe(400);
  });
});
