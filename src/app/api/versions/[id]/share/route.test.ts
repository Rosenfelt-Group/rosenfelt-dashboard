import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { schema: () => ({ rpc }) } }));
import { POST } from "./route";

const V = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const call = (id: string) => POST(new Request("https://d.test/x", { method: "POST" }) as never, { params: Promise.resolve({ id }) });

beforeEach(() => rpc.mockReset());

describe("POST /api/versions/[id]/share", () => {
  it("rejects a non-uuid id without calling the database", async () => {
    const r = await call("nope");
    expect(r.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shares a draft through the atomic function", async () => {
    rpc.mockResolvedValue({ data: [{ version_id: V, version_no: 3, superseded_count: 1 }], error: null });
    const r = await call(V);
    expect(rpc).toHaveBeenCalledWith("share_version", { p_version: V });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version_id: V, version_no: 3, superseded_count: 1 });
  });
  it("maps 'only a draft can be shared' to 409 and 'not found' to 404, with no raw database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "only a draft can be shared" } });
    let r = await call(V);
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).not.toContain("P0001");
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "version not found" } });
    r = await call(V);
    expect(r.status).toBe(404);
  });
  it("returns 500 with a generic message for unexpected errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret internal detail" } });
    const r = await call(V);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret internal detail");
  });
});
