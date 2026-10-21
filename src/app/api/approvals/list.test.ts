import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ cols: "" as string }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = (c: string) => { s.cols = c; return b; };
      b.order = () => b; b.eq = () => b; b.limit = () => b;
      b.then = (res: (v: unknown) => void) => res({ data: [{ id: "a1", action_type: "email_send", status: "approved", executed_at: null }], error: null });
      return b;
    },
  },
}));
import { GET } from "./route";

describe("GET /api/approvals (R38)", () => {
  it("returns executed_at for each row", async () => {
    const rows = await (await GET(new NextRequest("http://x/api/approvals?history=true"))).json();
    expect(rows[0]).toHaveProperty("executed_at", null);
    // select("*") or an explicit list that names executed_at
    expect(s.cols === "*" || s.cols.includes("executed_at")).toBe(true);
  });
});
