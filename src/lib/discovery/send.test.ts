import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  updated: null as unknown,
  updates: [] as { row: Record<string, unknown>; eqs: [string, unknown][] }[],
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const eqs: [string, unknown][] = [];
        let row: Record<string, unknown> | null = null;
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = (k: string, v: unknown) => { eqs.push([k, v]); return b; };
        b.update = (r: Record<string, unknown>) => { row = r; return b; };
        b.insert = async (r: Record<string, unknown>) => { s.inserts.push({ table, row: r }); return { error: null }; };
        b.maybeSingle = async () => {
          if (row) { s.updates.push({ row, eqs }); return { data: s.updated, error: null }; }
          return { data: s.invite, error: null };
        };
        return b;
      },
    }),
  },
}));

import { finalizeSend } from "./send";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const snapshot = {
  version: "template:t1", title: "Small Nonprofit", template: { id: "t1", name: "Small Nonprofit" },
  sections: [{ id: "a", title: "A", fields: [
    { id: "q1", type: "yes_no", label: "Sensitive?", followUpOn: "Yes", followUpLabel: "What kind?" },
    { id: "q2", type: "text", label: "Why?", showIf: { field: "removed", in: ["x"] } },
  ] }],
};

beforeEach(() => {
  s.updates = []; s.inserts = [];
  s.updated = { id: ID };
  s.invite = {
    id: ID, token: "tok", lead_id: "lead1", status: "draft", project_title: "Intake", questionnaire_snapshot: snapshot,
    created_at: "2026-10-01T00:00:00Z", expires_at: "2026-11-30T00:00:00Z",
  };
});

describe("finalizeSend", () => {
  it("freezes the snapshot, marks it sent and logs it on the lead", async () => {
    const r = await finalizeSend(ID);
    expect(r).toMatchObject({ ok: true, inviteId: ID, token: "tok", leadId: "lead1" });
    if (r.ok) expect(r.link).toMatch(/\/discovery\/\?t=tok$/);

    const { row, eqs } = s.updates[0];
    expect(row.status).toBe("sent");
    expect(eqs).toContainEqual(["status", "draft"]);
    const frozen = row.questionnaire_snapshot as typeof snapshot & { estimated_minutes: number };
    expect(frozen.sections[0].fields[1]).not.toHaveProperty("showIf");
    expect(frozen.estimated_minutes).toBeGreaterThan(0);
    // 60-day window from creation is kept, counted from now.
    const days = (new Date(row.expires_at as string).getTime() - new Date(row.sent_at as string).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(60);

    expect(s.inserts).toEqual([{ table: "lead_activities", row: expect.objectContaining({ lead_id: "lead1", content: "Discovery questionnaire sent: Intake" }) }]);
  });

  it("refuses an invite that has already been sent", async () => {
    s.invite = { ...s.invite!, status: "sent" };
    expect(await finalizeSend(ID)).toMatchObject({ ok: false, status: 409 });
    expect(s.updates).toEqual([]);
  });

  it("loses the race cleanly when another request sent it first", async () => {
    s.updated = null;
    expect(await finalizeSend(ID)).toMatchObject({ ok: false, status: 409 });
    expect(s.inserts).toEqual([]);
  });

  it("refuses an empty or invalid questionnaire", async () => {
    s.invite = { ...s.invite!, questionnaire_snapshot: { ...snapshot, sections: [] } };
    expect(await finalizeSend(ID)).toMatchObject({ ok: false, status: 422 });
    // A draft started from the blank template, still without questions.
    s.invite = { ...s.invite!, questionnaire_snapshot: { ...snapshot, sections: [{ id: "questions", title: "Questions", fields: [] }] } };
    expect(await finalizeSend(ID)).toMatchObject({ ok: false, status: 422, error: "Add at least one question before sending." });
    s.invite = { ...s.invite!, questionnaire_snapshot: null };
    expect(await finalizeSend(ID)).toMatchObject({ ok: false, status: 422 });
    expect(s.updates).toEqual([]);
  });

  it("404s for a missing or malformed id", async () => {
    s.invite = null;
    expect(await finalizeSend(ID)).toMatchObject({ ok: false, status: 404 });
    expect(await finalizeSend("nope")).toMatchObject({ ok: false, status: 404 });
  });
});
