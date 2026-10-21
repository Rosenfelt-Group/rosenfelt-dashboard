import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hashToken } from "@/lib/rooms/token";

const s = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { schema: () => ({ rpc: s.rpc }) } }));
import { POST } from "./route";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

const ENG = "11111111-1111-4111-8111-111111111111";
const ACC = "22222222-2222-4222-8222-222222222222";
const NEW = "33333333-3333-4333-8333-333333333333";
const call = (body?: unknown, id = ENG, accessId = ACC) =>
  POST(new NextRequest(`https://d.test/api/engagements/${id}/access/${accessId}/refresh`, {
    method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve({ id, accessId }) });

beforeEach(() => {
  s.rpc.mockReset();
  s.rpc.mockImplementation(async (_n: string, a: { p_expires_at: string }) => ({ data: [{ access_id: NEW, expires_at: a.p_expires_at }], error: null }));
});

describe("POST refresh link", () => {
  it("rejects bad ids and bad bodies without calling the database", async () => {
    expect((await call(undefined, "x")).status).toBe(400);
    expect((await call(undefined, ENG, "x")).status).toBe(400);
    expect((await call({ expires_days: 999 })).status).toBe(400);
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("sends only the hash of the new token and returns the link once", async () => {
    const r = await call();
    expect(r.status).toBe(201);
    const body = await r.json();
    const token = body.link.split("/r/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [name, args] = s.rpc.mock.calls[0];
    expect(name).toBe("refresh_access");
    expect(args).toMatchObject({ p_eng: ENG, p_access: ACC, p_token_hash: hashToken(token) });
    expect(JSON.stringify(args)).not.toContain(token);
    expect(body.id).toBe(NEW);
    const days = (new Date(args.p_expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThan(60.1);
  });
  it("maps database refusals to 404/409/500 without leaking text or a token", async () => {
    s.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "link not found" } });
    expect((await call()).status).toBe(404);
    s.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "link already revoked" } });
    const r = await call();
    expect(r.status).toBe(409);
    const t = JSON.stringify(await r.json());
    expect(t).not.toContain("/r/");
    expect(t).not.toContain("P0001");
    s.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret" } });
    const r5 = await call();
    expect(r5.status).toBe(500);
    expect(JSON.stringify(await r5.json())).not.toContain("secret");
  });
});
