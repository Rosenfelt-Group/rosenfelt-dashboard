import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/research/test-fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as { client: () => unknown } }));
vi.mock("@/lib/supabase-admin", () => ({ get supabaseAdmin() { return h.db.client(); } }));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));

import { POST } from "./route";

const B = "11111111-1111-4111-8111-111111111111";
const run = (body: unknown) => POST(new NextRequest("http://x/api/research/run", { method: "POST", body: JSON.stringify(body) }));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const db = new FakeDb();
  h.db = db;
  db.tables.businesses = [{ id: B, name: "Eastside Youth Arts" }];
  process.env.AVERY_AGENT_URL = "http://avery.test";
  process.env.AVERY_WEBHOOK_SECRET = "s";
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "row", business_id: B, details: {} }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/research/run", () => {
  it("with business_id runs organization research on that business, topic defaulting to its name", async () => {
    const res = await run({ business_id: B });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, business_id: B, research: { id: "row" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://avery.test/research/run");
    expect(JSON.parse(init.body as string)).toEqual({ business_id: B, topic: "Eastside Youth Arts" });
  });

  it("with an unknown or bad business_id it does not call Avery", async () => {
    expect((await run({ business_id: "22222222-2222-4222-8222-222222222222" })).status).toBe(404);
    expect((await run({ business_id: "nope" })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("without business_id it still fires a library brief through Avery's chat", async () => {
    expect((await run({ topic: "SMS tools" })).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://avery.test/chat");
    expect(JSON.parse(init.body as string).text).toBe("Run research brief on: SMS tools");
    expect((await run({})).status).toBe(400);
  });
});
