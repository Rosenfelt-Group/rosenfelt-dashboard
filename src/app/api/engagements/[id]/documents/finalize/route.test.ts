import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  deliverable: { data: null as unknown, error: null as unknown },
  head: new Uint8Array(),
  downloadError: null as unknown,
  removed: [] as string[][],
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: s.rpc,
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b; b.eq = () => b;
        b.maybeSingle = async () => s.deliverable;
        return b;
      },
    }),
    storage: {
      from: () => ({
        download: () => ({ asStream: async () => (s.downloadError ? { data: null, error: s.downloadError } : { data: new Response(s.head).body, error: null }) }),
        remove: async (p: string[]) => { s.removed.push(p); return { data: p, error: null }; },
      }),
    },
  },
}));
import { POST } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const DEL = "22222222-2222-4222-8222-222222222222";
const UP = "33333333-3333-4333-8333-333333333333";
const PATH = `${ENG}/${DEL}/${UP}/document.pdf`;
const call = (body: unknown = { deliverable_id: DEL, upload_id: UP, filename: "Proposal.pdf" }) =>
  POST(new NextRequest(`https://d.test/api/engagements/${ENG}/documents/finalize`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: ENG }) });

beforeEach(() => {
  s.deliverable = { data: { id: DEL, engagement_id: ENG, kind: "document" }, error: null };
  s.head = new TextEncoder().encode("%PDF-1.7\n");
  s.downloadError = null; s.removed = [];
  s.rpc.mockReset();
  s.rpc.mockResolvedValue({ data: [{ version_id: "v", version_no: 3 }], error: null });
});

describe("POST documents/finalize", () => {
  it("checks contents, then lets the database check size/type and create the draft", async () => {
    const r = await call({ deliverable_id: DEL, upload_id: UP, filename: "Proposal.pdf", change_summary: "Pricing updated" });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ version_id: "v", version_no: 3 });
    expect(s.rpc).toHaveBeenCalledWith("add_document_version", {
      p_deliverable: DEL, p_upload: UP, p_ext: "pdf", p_filename: "Proposal.pdf", p_change_summary: "Pricing updated",
    });
    expect(s.removed).toEqual([]);
  });
  it("deletes the object and refuses when the contents do not match the extension", async () => {
    s.head = new TextEncoder().encode("<html><script>alert(1)</script>");
    const r = await call();
    expect(r.status).toBe(400);
    expect(s.removed).toEqual([[PATH]]);
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("deletes the object when the database refuses it (size, MIME, duplicate)", async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "file size not allowed" } });
    const r = await call();
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).not.toContain("file size not allowed");
    expect(s.removed).toEqual([[PATH]]);
  });
  it("keeps the object on an unexpected database error (a row may exist; never orphan a row)", async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection" } });
    expect((await call()).status).toBe(500);
    expect(s.removed).toEqual([]);
  });
  it("404s when the upload or deliverable is missing, and refuses prototype deliverables", async () => {
    s.downloadError = { message: "not found" };
    expect((await call()).status).toBe(404);
    s.downloadError = null;
    s.deliverable = { data: null, error: null };
    expect((await call()).status).toBe(404);
    s.deliverable = { data: { id: DEL, engagement_id: ENG, kind: "prototype" }, error: null };
    expect((await call()).status).toBe(409);
  });
  it("refuses a binary renamed .txt and removes the object", async () => {
    s.head = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    const r = await call({ deliverable_id: DEL, upload_id: UP, filename: "x.txt" });
    expect(r.status).toBe(400);
    expect(s.removed).toEqual([[`${ENG}/${DEL}/${UP}/document.txt`]]);
  });
  it("refuses HTML renamed .png", async () => {
    s.head = new TextEncoder().encode("<svg onload=alert(1)>");
    const r = await call({ deliverable_id: DEL, upload_id: UP, filename: "x.png" });
    expect(r.status).toBe(400);
    expect(s.removed).toHaveLength(1);
  });
  it("refuses an empty object and a disallowed name without touching the database", async () => {
    s.head = new Uint8Array();
    expect((await call()).status).toBe(400);
    expect(s.removed).toEqual([[PATH]]);
    s.removed = [];
    expect((await call({ deliverable_id: DEL, upload_id: UP, filename: "a.html" })).status).toBe(400);
    expect(s.removed).toEqual([]);
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("sanitizes the filename passed to the database and uses the lowercased upload id", async () => {
    await call({ deliverable_id: DEL, upload_id: UP.toUpperCase(), filename: "a\r\n\"b/..\\Q3.PDF" });
    expect(s.rpc.mock.calls[0][1]).toMatchObject({ p_upload: UP, p_filename: "Q3.PDF", p_ext: "pdf" });
  });
  it("does not echo raw database text on an unexpected error", async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation secret_table" } });
    const r = await call();
    expect(JSON.stringify(await r.json())).not.toContain("secret_table");
  });
});
