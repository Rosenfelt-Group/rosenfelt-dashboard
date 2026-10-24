import { describe, expect, it } from "vitest";
import { buildKpis, buildTodayQueue, type TodayRaw } from "./today-queue";

const biz = (name: string) => ({ name });
const base = (over: Partial<TodayRaw> = {}): TodayRaw => ({
  today: "2026-10-24",
  now: "2026-10-24T15:00:00Z",
  inbox: { count: 0, latest: null },
  briefs: [],
  proposedScopes: [],
  staleQuestionnaires: [],
  roomEvents: [],
  nextSteps: [],
  existingClientSignups: [],
  duplicates: null,
  ...over,
});

describe("buildTodayQueue", () => {
  it("is empty when nothing needs doing", () => {
    expect(buildTodayQueue(base())).toEqual([]);
  });

  it("lists next steps due today or overdue, not future ones, with lead ids for Snooze/Done", () => {
    const items = buildTodayQueue(base({
      nextSteps: [
        { id: "l1", next_step: "Send intro email", next_step_due: "2026-10-22", business: biz("Cedar Hill") },
        { id: "l2", next_step: "Call Ruth", next_step_due: "2026-10-24", business: biz("Maple") },
        { id: "l3", next_step: "Later", next_step_due: "2026-10-30", business: biz("Future") },
        { id: "l4", next_step: null, next_step_due: "2026-10-20", business: biz("No step") },
      ],
    }));
    expect(items.map(i => i.id)).toEqual(["next_step:l1", "next_step:l2"]);
    expect(items[0]).toMatchObject({
      type: "next_step", severity: "high", lead_id: "l1", link: "/crm?deal=l1",
      title: "Cedar Hill: Send intro email", subtitle: "2 days late",
    });
    expect(items[1]).toMatchObject({ severity: "medium", subtitle: "Due today" });
  });

  it("builds scope, brief, questionnaire, inbox, room and existing-client items with links", () => {
    const items = buildTodayQueue(base({
      inbox: { count: 2, latest: { subject: "Hello", contact_email: "x@eastside.org", timestamp: "2026-10-24T10:00:00Z" } },
      briefs: [{ id: "b1", completed_at: "2026-10-23T10:00:00Z", created_at: "2026-10-23T09:00:00Z", invite: { id: "i1", project_title: "Literacy app", business: biz("Maple County Literacy") } }],
      proposedScopes: [{ id: "v2", version_no: 2, created_at: "2026-10-24T09:00:00Z", created_by: "riley", change_note: "2 sections changed", document: { id: "d1", title: "Youth arts site", business: biz("Eastside Youth Arts") } }],
      staleQuestionnaires: [{ id: "i9", project_title: null, sent_at: "2026-10-17T10:00:00Z", opened_at: "2026-10-18T10:00:00Z", status: "opened", business: biz("Riverbend") }],
      roomEvents: [
        { engagement_id: "e1", type: "room_opened", created_at: "2026-10-24T08:00:00Z", engagement: { id: "e1", title: "Prototype", business: biz("Harbor Light") }, contact: { name: "Dana" } },
        { engagement_id: "e1", type: "version_viewed", created_at: "2026-10-24T08:05:00Z", engagement: { id: "e1", title: "Prototype", business: biz("Harbor Light") }, contact: null },
      ],
      existingClientSignups: [{ id: "a1", created_at: "2026-10-23T08:00:00Z", metadata: { channel: "ebook", existing_client: true }, lead: { id: "l9", business_id: "biz9", business: biz("Her Promise Circle") } }],
    }));
    const byType = Object.fromEntries(items.map(i => [i.type, i]));
    expect(byType.scope).toMatchObject({ link: "/crm/scope/d1", severity: "medium", title: "Eastside Youth Arts: changes proposed to scope v2" });
    expect(byType.brief).toMatchObject({ link: "/crm/discovery/i1", title: "Discovery brief ready: Maple County Literacy" });
    expect(byType.questionnaire).toMatchObject({ link: "/crm/discovery/i9", subtitle: "Sent 7 days ago · opened, no answers" });
    expect(byType.inbox).toMatchObject({ link: "/crm/inbox", title: "2 emails from people not in the CRM" });
    expect(byType.room).toMatchObject({
      id: "room:e1", link: "/engagements/e1", severity: "low", title: "Dana opened Harbor Light's room",
      subtitle: "Prototype · opened 1 time · viewed 1 version", at: "2026-10-24T08:05:00Z",
    });
    expect(byType.existing_client).toMatchObject({ link: "/crm/organizations/biz9", title: "Existing client downloaded the ebook: Her Promise Circle" });
    expect(items.filter(i => i.type === "room")).toHaveLength(1);
    for (const i of items) {
      expect(i.title).toBeTruthy();
      expect(i.link.startsWith("/")).toBe(true);
      expect(["high", "medium", "low"]).toContain(i.severity);
    }
  });

  it("orders by severity, then newest first", () => {
    const items = buildTodayQueue(base({
      inbox: { count: 1, latest: { subject: null, contact_email: null, timestamp: "2026-10-20T10:00:00Z" } },
      proposedScopes: [{ id: "v1", version_no: 1, created_at: "2026-10-24T09:00:00Z", created_by: null, change_note: null, document: { id: "d", title: null, business: null } }],
      roomEvents: [{ engagement_id: "e", type: "room_opened", created_at: "2026-10-24T11:00:00Z", engagement: { id: "e", title: null, business: null }, contact: null }],
      nextSteps: [{ id: "l", next_step: "x", next_step_due: "2026-10-23", business: null }],
    }));
    expect(items.map(i => i.type)).toEqual(["next_step", "scope", "inbox", "room"]);
  });

  it("skips rows whose parent is missing (deleted or filtered out)", () => {
    const items = buildTodayQueue(base({
      briefs: [{ id: "b", completed_at: null, created_at: "2026-10-24T00:00:00Z", invite: null }],
      proposedScopes: [{ id: "v", version_no: 1, created_at: "2026-10-24T00:00:00Z", created_by: null, change_note: null, document: null }],
      existingClientSignups: [{ id: "a", created_at: "2026-10-24T00:00:00Z", metadata: null, lead: null }],
    }));
    expect(items).toEqual([]);
  });

  it("adds duplicates only when the table exists, ignoring dismissed ones", () => {
    expect(buildTodayQueue(base({ duplicates: null })).length).toBe(0);
    const items = buildTodayQueue(base({
      duplicates: [
        { id: "d1", kind: "business", a_id: "b1", reason: "Same domain harborlight.org", created_at: "2026-10-24T00:00:00Z" },
        { id: "d2", kind: "contact", a_id: "c1", status: "dismissed" },
        { id: "d3", kind: "lead", a_id: "l1" },
      ],
    }));
    expect(items.map(i => [i.id, i.link])).toEqual([["duplicate:d1", "/crm/organizations/b1"], ["duplicate:d3", "/crm?deal=l1"]]);
    expect(items[0].subtitle).toBe("Same domain harborlight.org");
  });
});

describe("buildKpis", () => {
  it("sums open pipeline, contracted value, hours and value by stage", () => {
    const { kpis, by_stage } = buildKpis({
      leads: [
        { stage: "new", estimated_value: 1000 },
        { stage: "proposal", estimated_value: "2500.50" },
        { stage: "proposal", estimated_value: null },
        { stage: "won", estimated_value: 9000 },
        { stage: "lost", estimated_value: 4000 },
        { stage: "quiz_started", estimated_value: 700 },
      ],
      activeClients: 2,
      services: [{ monthly_rate: "1500.00", project_rate: null }, { monthly_rate: null, project_rate: 750 }],
      hours: [{ hours: "2.5" }, { hours: 1.25 }],
      questionnairesOut: 3,
    });
    expect(kpis.open_pipeline).toEqual({ value: 3500.5, count: 3 });
    expect(kpis.active_clients).toEqual({ count: 2, contracted_monthly: 1500, contracted_project: 750 });
    expect(kpis.hours_this_month).toBe(3.75);
    expect(kpis.questionnaires_out).toBe(3);
    expect(by_stage.map(s => s.stage)).toEqual(["new", "qualification", "engaged", "call_demo_scheduled", "proposal", "won"]);
    expect(by_stage.find(s => s.stage === "proposal")).toMatchObject({ count: 2, value: 2500.5 });
    expect(by_stage.find(s => s.stage === "won")).toMatchObject({ count: 1, value: 9000 });
  });
});
