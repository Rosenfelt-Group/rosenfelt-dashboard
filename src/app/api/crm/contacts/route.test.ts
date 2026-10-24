import { describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: () => {
        const b: Record<string, unknown> = {};
        b.insert = () => b;
        b.select = () => b;
        b.eq = () => b;
        b.is = () => b;
        b.single = async () => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "contacts_email_norm_uidx"', details: "Key (email_norm)=(pat@hh.org) already exists." } });
        b.maybeSingle = async () => ({ data: { id: "c-existing" }, error: null });
        return b;
      },
    }),
  },
}));

import { POST } from "./route";

describe("POST /api/crm/contacts", () => {
  it("duplicate_email_returns_409_with_existing_id", async () => {
    const res = await POST({ json: async () => ({ first_name: "Pat", email: " Pat@HH.org " }) } as unknown as NextRequest);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A contact with this email already exists", existing_contact_id: "c-existing", existing_in_trash: false });
  });
});
