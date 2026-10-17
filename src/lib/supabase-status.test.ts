import { describe, it, expect } from "vitest";
import { normalizeSupabaseStatus } from "./supabase-status";

describe("normalizeSupabaseStatus", () => {
  it("turns missing or null lists into empty arrays", () => {
    const out = normalizeSupabaseStatus({
      status: { indicator: "none", description: "All Systems Operational" },
      components: [{ id: "1", name: "API", status: "operational" }],
      incidents: null,
    });
    expect(out.incidents).toEqual([]);
    expect(out.scheduled_maintenances).toEqual([]);
    expect(out.components).toHaveLength(1);
    expect(out.status).toEqual({ indicator: "none", description: "All Systems Operational" });
  });

  it("survives a body that isn't an object", () => {
    expect(normalizeSupabaseStatus(null)).toEqual({
      status: { indicator: "unknown", description: "Status unknown" },
      components: [], incidents: [], scheduled_maintenances: [],
    });
  });
});
