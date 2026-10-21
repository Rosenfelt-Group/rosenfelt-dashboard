import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  deliverables: { data: [] as unknown[] | null, error: null as unknown },
  selects: [] as string[],
}));
function chain(table: string) {
  const b: Record<string, unknown> = {};
  b.select = (cols: string) => { s.selects.push(cols); return b; };
  b.eq = () => b;
  b.order = async () => s.deliverables;
  b.single = async () => table === "engagements" ? { data: { id: "e", business_id: "b" }, error: null } : { data: { id: "b", name: "Acme" }, error: null };
  return b;
}
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { schema: () => ({ from: (t: string) => chain(t) }) },
}));
import { GET } from "./route";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

const ENG = "11111111-1111-4111-8111-111111111111";
const call = () => GET(new NextRequest(`https://d.test/api/engagements/${ENG}`), { params: Promise.resolve({ id: ENG }) });
beforeEach(() => { s.selects = []; s.deliverables = { data: [], error: null }; });

describe("GET engagements/[id]", () => {
  it("selects version source and manifest so the page can tell documents from prototypes", async () => {
    await call();
    const sel = s.selects.find(c => c.includes("deliverable_versions"))!;
    expect(sel).toMatch(/\bsource\b/);
    expect(sel).toMatch(/\bmanifest\b/);
  });
  it("sorts versions newest first", async () => {
    s.deliverables = { data: [{ id: "d", versions: [{ version_no: 1 }, { version_no: 3 }, { version_no: 2 }] }], error: null };
    const body = await (await call()).json();
    expect(body.deliverables[0].versions.map((v: { version_no: number }) => v.version_no)).toEqual([3, 2, 1]);
  });
  it("returns a fixed message, not raw database text, when the deliverables query fails", async () => {
    s.deliverables = { data: null, error: { message: 'relation "rooms.secret" does not exist' } };
    const r = await call();
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body).toEqual({ error: "Could not load the room." });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
