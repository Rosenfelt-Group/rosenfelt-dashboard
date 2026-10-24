import { describe, it, expect } from "vitest";
import { countLines, isTrashKind, KIND_LABELS, parseTrashTarget, trashError, TRASH_KINDS } from "./trash";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";

describe("parseTrashTarget", () => {
  it("accepts every kind with a uuid and lowercases the id", () => {
    for (const kind of TRASH_KINDS) {
      expect(parseTrashTarget({ kind, id: ID.toUpperCase() })).toEqual({ ok: true, value: { kind, id: ID } });
    }
  });

  it("rejects unknown kinds, bad ids and missing input", () => {
    for (const bad of [null, undefined, {}, { kind: "org", id: ID }, { kind: "business" }, { kind: "business", id: "x" },
      { kind: "business", id: `${ID}0` }, { kind: "business", id: 5 }, { kind: ["business"], id: ID }, { kind: "Business", id: ID }]) {
      const r = parseTrashTarget(bad as never);
      expect(r.ok).toBe(false);
    }
    expect(parseTrashTarget({ kind: "widget", id: ID })).toMatchObject({ ok: false, error: expect.stringContaining("kind must be one of") });
    expect(parseTrashTarget({ kind: "lead", id: "1; drop" })).toEqual({ ok: false, error: "id must be a uuid" });
  });

  it("isTrashKind matches the SQL kinds", () => {
    expect(TRASH_KINDS).toEqual(["business", "contact", "lead", "client", "discovery_invite", "scope_document", "engagement", "business_research", "research_brief"]);
    expect(isTrashKind("contact")).toBe(true);
    expect(isTrashKind("toString")).toBe(false);
    expect(Object.keys(KIND_LABELS).sort()).toEqual([...TRASH_KINDS].sort());
  });
});

describe("trashError", () => {
  it("maps SQLSTATEs to HTTP and passes the live services on TR001", () => {
    const svc = [{ id: "s1", client_id: "c1", service: "Retainer", status: "active", stripe_subscription_id: "sub_1", stripe_subscription_status: "active" }];
    expect(trashError({ code: "TR001", message: "x", details: JSON.stringify(svc) })).toEqual({
      status: 409, body: { error: expect.stringContaining("Stripe"), code: "TR001", services: svc },
    });
    expect(trashError({ code: "TR002", message: "lead x not found" }).status).toBe(404);
    expect(trashError({ code: "TR003", message: "x" }, { TR003: "Not in Trash" }).body.error).toBe("Not in Trash");
    expect(trashError({ code: "TR004" }).status).toBe(400);
    expect(trashError({ code: "TR005" }).status).toBe(409);
    expect(trashError({ code: "TR006" }).status).toBe(409);
  });

  it("hides unknown errors behind a 500", () => {
    expect(trashError({ code: "23503", message: "fk violation detail" })).toEqual({ status: 500, body: { error: "Internal error" } });
    expect(trashError({ message: "boom" }).status).toBe(500);
    expect(trashError({ code: "TR001", details: "not json" }).body).not.toHaveProperty("services");
  });
});

describe("countLines", () => {
  it("labels non-zero counts", () => {
    expect(countLines({ contacts: 1, leads: 2, clients: 0, lead_activities: 1, mystery_rows: 3 }))
      .toEqual(["1 person", "2 deals", "1 timeline entry", "3 mystery rows"]);
  });
});
