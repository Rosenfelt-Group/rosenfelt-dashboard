import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Res = { data: unknown; error: unknown };
const s = vi.hoisted(() => ({
  queue: {} as Record<string, Res[]>,
  inserts: [] as unknown[],
  eqs: [] as unknown[][],
  signed: [] as string[],
  signError: null as unknown,
}));
function chain(table: string) {
  const b: Record<string, unknown> = {};
  const next = async () => (s.queue[table] ?? []).shift() ?? { data: null, error: null };
  b.select = () => b;
  b.eq = (...a: unknown[]) => { s.eqs.push([table, ...a]); return b; };
  b.insert = (row: unknown) => { s.inserts.push([table, row]); return b; };
  b.single = next;
  // Honors the engagement filter: a deliverable of another engagement is not found.
  b.maybeSingle = async () => {
    const r = await next();
    const d = r.data as { engagement_id?: string } | null;
    const f = s.eqs.filter(e => e[0] === table && e[1] === "engagement_id").pop();
    return d && d.engagement_id && f && f[2] !== d.engagement_id ? { data: null, error: null } : r;
  };
  return b;
}
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({ from: (t: string) => chain(t) }),
    storage: { from: () => ({ createSignedUploadUrl: async (p: string) => { s.signed.push(p); return s.signError ? { data: null, error: s.signError } : { data: { signedUrl: `https://x.supabase.co/storage/v1/object/upload/sign/room-documents/${p}?token=T`, path: p, token: "T" }, error: null }; } }) },
  },
}));
import { POST } from "./route";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

const ENG = "11111111-1111-4111-8111-111111111111";
const DEL = "22222222-2222-4222-8222-222222222222";
const call = (body: unknown) => POST(new NextRequest(`https://d.test/api/engagements/${ENG}/documents`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id: ENG }) });

beforeEach(() => { s.queue = {}; s.inserts = []; s.eqs = []; s.signed = []; s.signError = null; });

describe("POST documents (prepare upload)", () => {
  it("refuses a disallowed type before touching the database", async () => {
    const r = await call({ filename: "x.html", size: 10, deliverable_title: "Proposal" });
    expect(r.status).toBe(400);
    expect(s.eqs).toEqual([]);
  });
  it("creates a document deliverable and signs an upload path under it", async () => {
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }], deliverables: [{ data: { id: DEL }, error: null }] };
    const r = await call({ filename: "Q3 Proposal.PDF", size: 1234, deliverable_title: "Proposal" });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(s.inserts).toEqual([["deliverables", { engagement_id: ENG, title: "Proposal", kind: "document" }]]);
    expect(s.signed[0]).toMatch(new RegExp(`^${ENG}/${DEL}/[0-9a-f-]{36}/document\\.pdf$`));
    expect(body).toMatchObject({ deliverable_id: DEL, filename: "Q3 Proposal.PDF", content_type: "application/pdf" });
    expect(s.signed[0]).toContain(body.upload_id);
  });
  it("refuses an existing deliverable that is a prototype, and a closed room", async () => {
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }], deliverables: [{ data: { id: DEL, kind: "prototype" }, error: null }] };
    expect((await call({ filename: "a.pdf", size: 1, deliverable_id: DEL })).status).toBe(409);
    s.queue = { engagements: [{ data: { id: ENG, status: "closed" }, error: null }] };
    expect((await call({ filename: "a.pdf", size: 1, deliverable_title: "x" })).status).toBe(409);
    expect(s.signed).toEqual([]);
  });
  it("rejects bad ids, empty/oversize sizes, wrong filenames and unknown deliverables", async () => {
    expect((await POST(new NextRequest("https://d.test/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(400);
    expect((await call({ filename: "a.pdf", size: 0, deliverable_title: "x" })).status).toBe(400);
    expect((await call({ filename: "a.pdf", size: 26214401, deliverable_title: "x" })).status).toBe(400);
    expect((await call({ filename: "\u0001.pdf.exe", size: 5, deliverable_title: "x" })).status).toBe(400);
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }], deliverables: [{ data: null, error: null }] };
    expect((await call({ filename: "a.pdf", size: 1, deliverable_id: DEL })).status).toBe(404);
    expect(s.signed).toEqual([]);
  });
  it("sanitizes hostile names into the returned filename and never into the path", async () => {
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }], deliverables: [{ data: { id: DEL }, error: null }] };
    const r = await call({ filename: "..\\..\\a\r\n\"b\u202E.JPEG", size: 5, deliverable_title: "P" });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.filename).toBe("ab.JPEG");
    expect(body.content_type).toBe("image/jpeg");
    expect(s.signed[0]).toMatch(/\/document\.jpg$/);
  });
  it("returns a fixed message when signing fails", async () => {
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }], deliverables: [{ data: { id: DEL }, error: null }] };
    s.signError = { message: "secret storage detail" };
    const r = await call({ filename: "a.pdf", size: 1, deliverable_title: "x" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret storage detail");
  });
  it("filters an existing deliverable by this engagement (another engagement's is 404, nothing signed)", async () => {
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }],
      deliverables: [{ data: { id: DEL, kind: "document", engagement_id: "99999999-9999-4999-8999-999999999999" }, error: null }] };
    expect((await call({ filename: "a.pdf", size: 1, deliverable_id: DEL })).status).toBe(404);
    expect(s.eqs).toContainEqual(["deliverables", "engagement_id", ENG]);
    expect(s.signed).toEqual([]);
  });
  it("accepts exactly 26214400 bytes", async () => {
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }], deliverables: [{ data: { id: DEL }, error: null }] };
    expect((await call({ filename: "a.pdf", size: 26214400, deliverable_title: "x" })).status).toBe(201);
  });
});
