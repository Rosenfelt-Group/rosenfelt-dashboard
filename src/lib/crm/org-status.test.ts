import { describe, expect, it } from "vitest";
import { countByStatus, deriveOrgStatus, isLiveClient, orgStatus, parseOrgStatusFilter, todayNY } from "./org-status";

const T = "2026-10-25";
const client = (o: Partial<{ billing_status: string; contract_end: string | null; services: { status: string }[] }> = {}) =>
  ({ billing_status: "cancelled", contract_end: null, services: [], ...o });

describe("isLiveClient", () => {
  it("active or paused billing is live", () => {
    expect(isLiveClient(client({ billing_status: "active" }), T)).toBe(true);
    expect(isLiveClient(client({ billing_status: "paused" }), T)).toBe(true);
  });
  it("a pending, active or paused service is live even when billing reads cancelled", () => {
    for (const status of ["pending_activation", "active", "paused"]) {
      expect(isLiveClient(client({ services: [{ status: "cancelled" }, { status }] }), T)).toBe(true);
    }
  });
  it("a client in setup (no services, no end date) is live", () => {
    expect(isLiveClient(client(), T)).toBe(true);
    expect(isLiveClient(client({ contract_end: T }), T)).toBe(true);
  });
  it("all services cancelled, or the contract ended with no services, is over", () => {
    expect(isLiveClient(client({ services: [{ status: "cancelled" }] }), T)).toBe(false);
    expect(isLiveClient(client({ contract_end: "2026-10-24" }), T)).toBe(false);
  });
});

describe("deriveOrgStatus / orgStatus", () => {
  it("no client records is a prospect", () => expect(deriveOrgStatus([], T)).toBe("prospect"));
  it("any live record makes a client", () => {
    expect(deriveOrgStatus([client({ services: [{ status: "cancelled" }] }), client({ billing_status: "active" })], T)).toBe("client");
  });
  it("only finished records make a past client", () => {
    expect(deriveOrgStatus([client({ services: [{ status: "cancelled" }] })], T)).toBe("past_client");
  });
  it("the override wins; unknown overrides are ignored", () => {
    expect(orgStatus("partner", [client({ billing_status: "active" })], T)).toBe("partner");
    expect(orgStatus("past_client", [client({ billing_status: "active" })], T)).toBe("past_client");
    expect(orgStatus("vendor", [], T)).toBe("prospect");
    expect(orgStatus(null, [client()], T)).toBe("client");
  });
});

describe("filters and counts", () => {
  it("parses ?status=", () => {
    expect(parseOrgStatusFilter("client")).toBe("client");
    expect(parseOrgStatusFilter("past")).toBe("past_client");
    expect(parseOrgStatusFilter("past_client")).toBe("past_client");
    expect(parseOrgStatusFilter("bogus")).toBe("all");
    expect(parseOrgStatusFilter(null)).toBe("all");
  });
  it("counts every status", () => {
    expect(countByStatus([{ status: "client" }, { status: "client" }, { status: "partner" }])).toEqual({ all: 3, prospect: 0, client: 2, past_client: 0, partner: 1 });
  });
  it("todayNY uses New York time", () => {
    expect(todayNY(new Date("2026-10-25T03:00:00Z"))).toBe("2026-10-24");
    expect(todayNY(new Date("2026-10-25T05:00:00Z"))).toBe("2026-10-25");
  });
});
