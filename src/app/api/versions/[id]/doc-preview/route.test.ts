import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { verifyDocGrant } from "@/lib/rooms/grant";

const s = vi.hoisted(() => ({ row: { data: null as unknown, error: null as unknown } }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { schema: () => ({ from: () => { const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => s.row; return b; } }) },
}));
import { GET } from "./route";

const V = "44444444-4444-4444-8444-444444444444";
const PREFIX = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
const SECRET = "s".repeat(32);
const call = (id = V) => GET(new NextRequest(`https://d.test/api/versions/${id}/doc-preview`), { params: Promise.resolve({ id }) });
const row = (file: string, filename: string, source = "upload") => ({ data: { storage_prefix: PREFIX, source, manifest: { file, filename } }, error: null });

beforeEach(() => {
  process.env.ROOM_GRANT_SECRET = SECRET;
  process.env.NEXT_PUBLIC_PREVIEW_URL = "https://preview.test/";
  s.row = row("document.pdf", "Proposal.pdf");
});

describe("GET versions/[id]/doc-preview", () => {
  it("returns a /dp URL whose grant is bound to the object path and display name", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(url.startsWith("https://preview.test/dp/")).toBe(true);
    const g = verifyDocGrant(url.slice("https://preview.test/dp/".length), SECRET);
    expect(g).toMatchObject({ ok: true, path: `${PREFIX}/document.pdf`, filename: "Proposal.pdf" });
  });
  it("falls back to the stored file name when the manifest name is unsafe", async () => {
    s.row = row("document.pdf", 'a"\r\nb.pdf');
    const { url } = await (await call()).json();
    expect(verifyDocGrant(url.split("/dp/")[1], SECRET)).toMatchObject({ ok: true, filename: "document.pdf" });
  });
  it("refuses office formats with a helpful message", async () => {
    s.row = row("document.docx", "Plan.docx");
    const r = await call();
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/can't be previewed/i);
  });
  it("404s a missing version, a non-upload version, a bad id and a bad manifest file", async () => {
    s.row = { data: null, error: null };
    expect((await call()).status).toBe(404);
    s.row = row("document.pdf", "x.pdf", "agent");
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(400);
    s.row = row("../../etc/passwd", "x.pdf");
    expect((await call()).status).toBe(404);
  });
  it("500s with a fixed message when the grant secret is missing", async () => {
    delete process.env.ROOM_GRANT_SECRET;
    const r = await call();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("SECRET=");
  });
});
