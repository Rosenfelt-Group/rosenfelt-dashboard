import { describe, it, expect } from "vitest";
import { CreateEngagementSchema, IssueAccessSchema, PrototypeRequestSchema } from "./schemas";

const BIZ = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";

describe("schemas", () => {
  it("accepts a minimal engagement and defaults modules", () => {
    const r = CreateEngagementSchema.parse({ business_id: BIZ, relationship: "partner", title: "  Shared project  " });
    expect(r.title).toBe("Shared project");
    expect(r.modules).toEqual({ discovery: false, solutions: true });
  });

  it("rejects unknown relationships and blank titles", () => {
    expect(CreateEngagementSchema.safeParse({ business_id: BIZ, relationship: "vendor", title: "x" }).success).toBe(false);
    expect(CreateEngagementSchema.safeParse({ business_id: BIZ, relationship: "client", title: "   " }).success).toBe(false);
    expect(CreateEngagementSchema.safeParse({ business_id: "nope", relationship: "client", title: "x" }).success).toBe(false);
  });

  it("bounds the access expiry", () => {
    expect(IssueAccessSchema.parse({}).expires_days).toBe(60);
    expect(IssueAccessSchema.safeParse({ expires_days: 0 }).success).toBe(false);
    expect(IssueAccessSchema.safeParse({ expires_days: 400 }).success).toBe(false);
  });

  it("requires a brief and exactly one of deliverable_id / deliverable_title", () => {
    const ok = { agent: "casey", brief: "Build it" };
    expect(PrototypeRequestSchema.safeParse({ ...ok, deliverable_title: "App" }).success).toBe(true);
    expect(PrototypeRequestSchema.safeParse({ ...ok, deliverable_id: BIZ }).success).toBe(true);
    expect(PrototypeRequestSchema.safeParse(ok).success).toBe(false);
    expect(PrototypeRequestSchema.safeParse({ ...ok, deliverable_id: BIZ, deliverable_title: "App" }).success).toBe(false);
    expect(PrototypeRequestSchema.safeParse({ agent: "casey", brief: "", deliverable_title: "App" }).success).toBe(false);
    expect(PrototypeRequestSchema.safeParse({ agent: "sam", brief: "x", deliverable_title: "App" }).success).toBe(false);
  });
});
