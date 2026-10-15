import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  order: [] as string[],
  rpcResult: { data: null as unknown, error: null as null | { code: string; message: string } },
  removeError: null as null | { message: string },
  removed: [] as { bucket: string; names: string[] }[],
  rpcArgs: [] as unknown[],
  // PATCH (Task 7)
  updateResult: { data: null as unknown, error: null as null | { message: string } },
  updates: [] as unknown[],
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: async (...a: unknown[]) => { s.order.push("rpc"); s.rpcArgs.push(a); return s.rpcResult; },
      from: () => {
        const b: Record<string, unknown> = {};
        b.update = (row: unknown) => { s.updates.push(row); return b; };
        b.eq = () => b;
        b.select = () => b;
        b.maybeSingle = async () => s.updateResult;
        return b;
      },
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (names: string[]) => {
          s.order.push(`remove:${bucket}`);
          s.removed.push({ bucket, names });
          return s.removeError ? { data: null, error: s.removeError } : { data: names, error: null };
        },
      }),
    },
  },
}));
vi.mock("@/lib/rooms/session-user", () => ({ sessionUsername: async () => "brian" }));

import { DELETE, PATCH } from "./route";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const del = (id = ID) => DELETE(new NextRequest(`https://d.test/api/deliverables/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  s.order = []; s.removed = []; s.rpcArgs = []; s.removeError = null; s.updates = [];
  s.rpcResult = { data: [
    { bucket: "prototypes", object_name: "e/d/v1/index.html" },
    { bucket: "room-documents", object_name: "e/d/u/document.pdf" },
  ], error: null };
});

describe("DELETE /api/deliverables/[id]", () => {
  it("rejects a non-uuid without touching the database", async () => {
    const r = await del("nope");
    expect(r.status).toBe(400);
    expect(s.order).toEqual([]);
  });
  it("deletes rows first (atomic function) and then removes the returned files", async () => {
    const r = await del();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ deleted: true, files_removed: 2, files_left: 0 });
    expect(s.rpcArgs[0]).toEqual(["delete_deliverable", { p_deliverable: ID, p_actor: "brian" }]);
    expect(s.order[0]).toBe("rpc");
    expect(s.order.slice(1).sort()).toEqual(["remove:prototypes", "remove:room-documents"]);
  });
  it("still reports success when file removal fails, with the number of files left", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    s.removeError = { message: "storage down" };
    const r = await del();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ deleted: true, files_removed: 0, files_left: 2 });
    expect(err.mock.calls.flat().join(" ")).not.toContain("e/d/");
    err.mockRestore();
  });
  it("never removes files when the database delete fails", async () => {
    s.rpcResult = { data: null, error: { code: "P0002", message: "deliverable not found" } };
    expect((await del()).status).toBe(404);
    s.rpcResult = { data: null, error: { code: "XX000", message: "secret detail" } };
    const r = await del();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret detail");
    expect(s.removed).toEqual([]);
  });
});

const patch = (body: unknown, id = ID) =>
  PATCH(new NextRequest(`https://d.test/api/deliverables/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });

describe("PATCH /api/deliverables/[id]", () => {
  it("saves a normalized welcome message", async () => {
    s.updateResult = { data: { id: ID, welcome_message: "Hi\nthere" }, error: null };
    const r = await patch({ welcome_message: " Hi\r\nthere " });
    expect(r.status).toBe(200);
    expect(s.updates).toEqual([{ welcome_message: "Hi\nthere" }]);
    expect(await r.json()).toEqual({ id: ID, welcome_message: "Hi\nthere" });
  });
  it("clears with null or whitespace", async () => {
    s.updateResult = { data: { id: ID, welcome_message: null }, error: null };
    await patch({ welcome_message: "   " });
    expect(s.updates).toEqual([{ welcome_message: null }]);
  });
  it("stores markup literally", async () => {
    s.updateResult = { data: { id: ID, welcome_message: "<script>x</script>" }, error: null };
    await patch({ welcome_message: "<script>x</script>" });
    expect(s.updates).toEqual([{ welcome_message: "<script>x</script>" }]);
  });
  it("rejects bad input and unknown ids", async () => {
    expect((await patch({ welcome_message: "x".repeat(1001) })).status).toBe(400);
    expect((await patch({ welcome_message: 5 })).status).toBe(400);
    expect((await patch({ welcome_message: "x", title: "y" })).status).toBe(400);
    expect((await patch({ welcome_message: "x" }, "nope")).status).toBe(400);
    expect(s.updates).toEqual([]);
    s.updateResult = { data: null, error: null };
    expect((await patch({ welcome_message: "x" })).status).toBe(404);
  });
  it("returns a generic 500 on a database error", async () => {
    s.updateResult = { data: null, error: { message: "secret" } };
    const r = await patch({ welcome_message: "x" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
  });
});
