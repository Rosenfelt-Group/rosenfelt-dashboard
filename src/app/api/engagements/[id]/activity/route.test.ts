import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ENG = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333333";

type Res = { data: unknown; error: { message: string } | null };
const state = vi.hoisted(() => ({
  events: { data: [], error: null } as Res,
  contacts: { data: [], error: null } as Res,
  versions: { data: [], error: null } as Res,
  calls: [] as string[],
  selects: [] as string[],
  limit: undefined as number | undefined,
  order: undefined as unknown[] | undefined,
}));

// Chainable, awaitable stub: every filter returns the builder; awaiting it resolves the table's result.
function table(name: string) {
  const res = () => (name === "engagement_events" ? state.events : name === "engagement_contacts" ? state.contacts : state.versions);
  const b: Record<string, unknown> = {};
  b.select = (cols: string) => { state.selects.push(cols); return b; };
  b.eq = () => b;
  b.in = () => b;
  b.order = (...a: unknown[]) => { if (name === "engagement_events") state.order = a; return b; };
  b.limit = (n: number) => { if (name === "engagement_events") state.limit = n; return b; };
  b.then = (ok: (v: Res) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({ from: (n: string) => { state.calls.push(n); return table(n); } }),
  },
}));

import { GET } from "./route";

const call = (id = ENG) =>
  GET(new NextRequest(`https://x.example/api/engagements/${id}/activity`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.calls = []; state.selects = []; state.limit = undefined; state.order = undefined;
  state.events = {
    data: [
      { id: 3, type: "version_viewed", created_at: "2026-10-14T10:00:00Z", contact_id: C1, version_id: V1 },
      { id: 2, type: "contact_identified", created_at: "2026-10-14T09:00:00Z", contact_id: C1, version_id: null },
      { id: 1, type: "room_opened", created_at: "2026-10-14T08:00:00Z", contact_id: null, version_id: null },
    ],
    error: null,
  };
  state.contacts = { data: [{ id: C1, name: "Ann", email: "ann@x.org", first_seen_at: "2026-10-14T09:00:00Z" }], error: null };
  state.versions = { data: [{ id: V1, version_no: 2, deliverable: { title: "Landing" } }], error: null };
});

describe("GET activity", () => {
  it("returns events newest first with contact and version attached", async () => {
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.order?.[0]).toBe("created_at");
    expect(state.order?.[1]).toMatchObject({ ascending: false });
    expect(body.events.map((e: { id: number }) => e.id)).toEqual([3, 2, 1]);
    expect(body.events[0]).toMatchObject({
      type: "version_viewed",
      contact: { name: "Ann", email: "ann@x.org" },
      version: { deliverable_title: "Landing", version_no: 2 },
    });
    expect(body.events[1].version).toBeNull();
    expect(body.events[2].contact).toBeNull();
  });

  it("lists contacts", async () => {
    const body = await (await call()).json();
    expect(body.contacts).toEqual([{ id: C1, name: "Ann", email: "ann@x.org", first_seen_at: "2026-10-14T09:00:00Z" }]);
  });

  it("returns 400 and queries nothing for a non-uuid id", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("degrades to contact:null when the contacts lookup fails", async () => {
    state.contacts = { data: null, error: { message: "boom" } };
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.events[0].contact).toBeNull();
    expect(body.contacts).toEqual([]);
  });

  it("degrades to version:null when the versions lookup fails", async () => {
    state.versions = { data: null, error: { message: "boom" } };
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.events[0].version).toBeNull();
    expect(body.events[0].contact).toMatchObject({ name: "Ann" });
  });

  it("returns a generic 500 when the events query fails", async () => {
    state.events = { data: null, error: { message: "secret db detail" } };
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("never exposes access_id or meta and never selects them", async () => {
    state.events = { data: [{ ...(state.events.data as object[])[0], access_id: "A", meta: { ip: "1" } }], error: null };
    const text = JSON.stringify(await (await call()).json());
    expect(text).not.toContain("access_id");
    expect(text).not.toContain("meta");
    expect(state.selects.join(",")).not.toMatch(/access_id|(^|,\s*)meta\s*(,|$)/);
    expect(state.selects[0]).toContain("deliverable_title:meta->>deliverable_title");
  });

  it("returns the deleted deliverable's title only for deliverable_deleted events", async () => {
    state.events = { data: [
      { id: 9, type: "deliverable_deleted", created_at: "2026-10-14T11:00:00Z", contact_id: null, version_id: null, deliverable_title: "Proposal" },
      { id: 8, type: "link_refreshed", created_at: "2026-10-14T10:30:00Z", contact_id: null, version_id: null, deliverable_title: null },
      { id: 7, type: "version_viewed", created_at: "2026-10-14T10:00:00Z", contact_id: C1, version_id: V1, deliverable_title: "ignored" },
    ], error: null };
    const body = await (await call()).json();
    expect(body.events[0]).toMatchObject({ type: "deliverable_deleted", deliverable_title: "Proposal" });
    expect(body.events[1].deliverable_title).toBeNull();
    expect(body.events[2].deliverable_title).toBeNull();
  });

  it("fetches at most 100 events", async () => {
    await call();
    expect(state.limit).toBe(100);
  });
});
