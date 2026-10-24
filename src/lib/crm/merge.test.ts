import { describe, it, expect, vi } from "vitest";
import { DismissBody, MergeBody, PreviewQuery, candidatesFor, mergeErrorResponse, recordHref, type DuplicateCandidate } from "./merge";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("MergeBody", () => {
  it("accepts a valid request", () => {
    const r = MergeBody.safeParse({ kind: "business", keep_id: A, merge_id: B, fields: { name: "merge", notes: "both" } });
    expect(r.success).toBe(true);
  });
  it("rejects the same id twice", () => {
    expect(MergeBody.safeParse({ kind: "lead", keep_id: A, merge_id: A }).success).toBe(false);
  });
  it("rejects fields that don't belong to the kind", () => {
    const r = MergeBody.safeParse({ kind: "lead", keep_id: A, merge_id: B, fields: { website: "merge" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("unknown field website");
  });
  it("allows 'both' only for notes", () => {
    expect(MergeBody.safeParse({ kind: "contact", keep_id: A, merge_id: B, fields: { email: "both" } }).success).toBe(false);
    expect(MergeBody.safeParse({ kind: "contact", keep_id: A, merge_id: B, fields: { notes: "both" } }).success).toBe(true);
  });
  it("rejects unknown kinds and bad ids", () => {
    expect(MergeBody.safeParse({ kind: "client", keep_id: A, merge_id: B }).success).toBe(false);
    expect(MergeBody.safeParse({ kind: "lead", keep_id: "x", merge_id: B }).success).toBe(false);
  });
});

describe("PreviewQuery / DismissBody", () => {
  it("parse", () => {
    expect(PreviewQuery.safeParse({ kind: "contact", keep_id: A, merge_id: B }).success).toBe(true);
    expect(PreviewQuery.safeParse({ kind: "contact", keep_id: A, merge_id: null }).success).toBe(false);
    expect(DismissBody.safeParse({ kind: "business", a_id: A, b_id: B, note: "two chapters" }).success).toBe(true);
    expect(DismissBody.safeParse({ kind: "business", a_id: A, b_id: A }).success).toBe(false);
  });
});

describe("mergeErrorResponse", () => {
  it("maps merge SQLSTATEs", async () => {
    const r = mergeErrorResponse({ code: "MG004", message: "merge: these deals belong to different organizations" });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("MG004");
    expect(mergeErrorResponse({ code: "MG001" }).status).toBe(404);
    expect(mergeErrorResponse({ code: "MG003" }).status).toBe(409);
  });
  it("keeps the field name for MG005", async () => {
    const r = mergeErrorResponse({ code: "MG005", message: "merge: utm_source stays with the surviving record" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("utm_source stays with the surviving record");
  });
  it("hides unknown errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = mergeErrorResponse({ code: "42P01", message: "relation does not exist" });
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe("Internal error");
    spy.mockRestore();
  });
});

describe("helpers", () => {
  it("recordHref", () => {
    expect(recordHref("business", A)).toBe(`/crm/organizations/${A}`);
    expect(recordHref("contact", A)).toBe(`/crm/people/${A}`);
    expect(recordHref("lead", A)).toBe(`/crm/leads/${A}`);
  });
  it("candidatesFor keeps pairs that include the id", () => {
    const row = (keep: string, merge: string): DuplicateCandidate => ({
      kind: "business", keep_id: keep, merge_id: merge, keep_label: "", merge_label: "", reasons: ["same_domain"],
      detail: {}, score: 0.9, dismissed: false,
    });
    const rows = [row(A, B), row(B, "c"), row("d", "e")];
    expect(candidatesFor(rows, B)).toHaveLength(2);
    expect(candidatesFor(rows, "d")).toHaveLength(1);
  });
});
