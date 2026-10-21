import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  deliverable: { data: null as unknown, error: null as unknown },
  engagement: { data: null as unknown, error: null as unknown },
  downloads: 0,
  head: new Uint8Array(),
  downloadError: null as unknown,
  fetchMode: "ok" as "ok" | "hang" | "status500" | "status404",
  fetchInit: null as RequestInit | null,
  removed: [] as string[][],
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: (...a: unknown[]) => { const p = s.rpc(...a); return Object.assign(Promise.resolve(p), { abortSignal: () => Promise.resolve(p) }); },
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        const f: Record<string, unknown> = {};
        b.select = () => b; b.eq = (k: string, v: unknown) => { f[k] = v; return b; };
        // Honors the filters: a deliverable of another engagement is not found.
        const row = async () => {
          if (table === "engagements") return s.engagement;
          const d = s.deliverable.data as { engagement_id?: string } | null;
          return d && f.engagement_id !== undefined && f.engagement_id !== d.engagement_id ? { data: null, error: null } : s.deliverable;
        };
        b.maybeSingle = row; b.single = row;
        return b;
      },
    }),
    storage: {
      from: () => ({
        createSignedUrl: async () => { s.downloads++; return s.downloadError ? { data: null, error: s.downloadError } : { data: { signedUrl: "https://storage.test/signed?token=t" }, error: null }; },
        remove: async (p: string[]) => { s.removed.push(p); return { data: p, error: null }; },
      }),
    },
  },
}));
import { POST } from "./route";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
  s.fetchInit = init ?? null;
  if (s.fetchMode === "hang") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (s.fetchMode === "status500") return new Response("x", { status: 500 });
  if (s.fetchMode === "status404") return new Response("x", { status: 404 });
  return new Response(s.head, { status: 206 });
}));

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
  s.engagement = { data: { id: ENG, status: "active" }, error: null };
  s.downloads = 0;
  s.downloadError = null; s.removed = []; s.fetchMode = "ok"; s.fetchInit = null;
  s.rpc.mockReset();
  s.rpc.mockResolvedValue({ data: [{ version_id: "v", version_no: 3 }], error: null });
});

describe("POST documents/finalize", () => {
  it("reads only the first bytes with a Range request and a deadline", async () => {
    await call();
    expect((s.fetchInit?.headers as Record<string, string>).Range).toBe("bytes=0-8191");
    expect(s.fetchInit?.signal).toBeInstanceOf(AbortSignal);
  });
  it("504s fast and KEEPS the object when reading the upload times out", async () => {
    s.fetchMode = "hang";
    const r = await call();
    expect(r.status).toBe(504);
    expect(s.removed).toEqual([]);
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("maps a storage 404 to 404 and a storage 5xx to 502, keeping the object", async () => {
    s.fetchMode = "status404";
    expect((await call()).status).toBe(404);
    s.fetchMode = "status500";
    expect((await call()).status).toBe(502);
    expect(s.removed).toEqual([]);
  });
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
  it("409s on a duplicate upload (23505) and does NOT delete the object that backs the live version", async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "upload already added" } });
    const r = await call();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "This upload was already added." });
    expect(s.removed).toEqual([]);
  });
  it("still deletes the object on P0001", async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "x" } });
    expect((await call()).status).toBe(400);
    expect(s.removed).toEqual([[PATH]]);
  });
  it("409s for a closed room and keeps the object", async () => {
    s.engagement = { data: { id: ENG, status: "closed" }, error: null };
    const r = await call();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "Engagement is closed" });
    expect(s.removed).toEqual([]);
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("404s a deliverable that belongs to another engagement without touching Storage", async () => {
    s.deliverable = { data: { id: DEL, engagement_id: "99999999-9999-4999-8999-999999999999", kind: "document" }, error: null };
    expect((await call()).status).toBe(404);
    expect(s.downloads).toBe(0);
    expect(s.removed).toEqual([]);
  });
});
