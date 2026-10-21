import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The real guards run here; only the session decode is stubbed. Supabase must
// never be reached when the guard refuses.
const session = vi.hoisted(() => ({ value: null as null | { username: string; role: string; permissions: string[] } }));
vi.mock("@/lib/session", () => ({
  COOKIE_NAME: "dashboard_session",
  verifySessionToken: async () => session.value,
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: new Proxy({}, { get: () => { throw new Error("supabase reached"); } }),
}));

import { GET as listLeads, POST as createLead } from "@/app/api/crm/leads/route";
import { POST as invoice } from "@/app/api/crm/client-services/[id]/invoice/route";

const req = (method: string, cookie = true) =>
  new NextRequest("https://dashboard.test/api/x", {
    method,
    headers: cookie ? { cookie: "dashboard_session=t", "content-type": "application/json" } : {},
    body: method === "GET" ? undefined : "{}",
  });
const ctx = { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) };
const viewer = { username: "v", role: "viewer", permissions: ["view_crm"] };

describe("CRM route guards", () => {
  it("rejects no session with 401", async () => {
    session.value = null;
    expect((await listLeads(req("GET", false))).status).toBe(401);
  });

  it("lets a viewer read but not write", async () => {
    session.value = viewer;
    await expect(listLeads(req("GET"))).rejects.toThrow("supabase reached");
    expect((await createLead(req("POST"))).status).toBe(403);
  });

  it("keeps invoicing admin-only", async () => {
    session.value = { ...viewer, permissions: ["view_crm", "manage_crm"] };
    expect((await invoice(req("POST"), ctx)).status).toBe(403);
  });

  it("lets an admin through", async () => {
    session.value = { username: "brian", role: "admin", permissions: [] };
    await expect(createLead(req("POST"))).rejects.toThrow("supabase reached");
  });
});
