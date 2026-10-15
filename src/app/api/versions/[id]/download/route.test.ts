import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  row: { data: null as unknown, error: null as unknown },
  signed: [] as unknown[][],
  signError: null as unknown,
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b; b.eq = () => b;
        b.maybeSingle = async () => s.row;
        return b;
      },
    }),
    storage: {
      from: () => ({
        createSignedUrl: async (...a: unknown[]) => {
          s.signed.push(a);
          return s.signError ? { data: null, error: s.signError } : { data: { signedUrl: "https://x.supabase.co/signed?token=T" }, error: null };
        },
      }),
    },
  },
}));
import { GET } from "./route";

const V = "44444444-4444-4444-8444-444444444444";
const PREFIX = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
const call = (id = V) => GET(new NextRequest(`https://d.test/api/versions/${id}/download`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  s.signed = []; s.signError = null;
  s.row = { data: { storage_prefix: PREFIX, source: "upload", manifest: { kind: "document", file: "document.pdf", filename: "Proposal.pdf" } }, error: null };
});

describe("GET versions/[id]/download", () => {
  it("returns a 60 s signed URL with the display name", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: "https://x.supabase.co/signed?token=T" });
    expect(s.signed[0]).toEqual([`${PREFIX}/document.pdf`, 60, { download: "Proposal.pdf" }]);
  });
  it("falls back to the stored file name when the manifest name is unsafe", async () => {
    s.row = { data: { storage_prefix: PREFIX, source: "upload", manifest: { file: "document.pdf", filename: 'a"\r\nb.pdf' } }, error: null };
    await call();
    expect(s.signed[0][2]).toEqual({ download: "document.pdf" });
  });
  it("400s a bad id, 404s a missing or non-upload version, fixed 500 on sign failure", async () => {
    expect((await call("x")).status).toBe(400);
    s.row = { data: null, error: null };
    expect((await call()).status).toBe(404);
    s.row = { data: { storage_prefix: PREFIX, source: "agent", manifest: { entry: "index.html" } }, error: null };
    expect((await call()).status).toBe(404);
    expect(s.signed).toEqual([]);
    s.row = { data: { storage_prefix: PREFIX, source: "upload", manifest: { file: "document.pdf" } }, error: null };
    s.signError = { message: "internal detail" };
    const r = await call();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("internal detail");
  });
  it("refuses a manifest file name that is not a plain document path", async () => {
    s.row = { data: { storage_prefix: PREFIX, source: "upload", manifest: { file: "../../x/document.pdf" } }, error: null };
    expect((await call()).status).toBe(404);
  });
});
