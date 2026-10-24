import { describe, expect, it } from "vitest";
import { CRMStage } from "@/types";
import { STAGES } from "./stages";
import {
  addDays, dayDiff, daysInStage, dueLabel, dueState, groupByColumn, isOpenDeal, pipelineColumns, progressLevel, NO_PROGRESS,
} from "./pipeline";

describe("pipelineColumns", () => {
  const cols = pipelineColumns();

  it("groups the three quiz stages into one Quiz funnel column, first", () => {
    expect(cols[0]).toMatchObject({ id: "quiz", label: "Quiz funnel", isQuizFunnel: true });
    expect(cols[0].stages).toEqual(["quiz_started", "quiz_completed", "snapshot_viewed"]);
    expect(cols.filter(c => c.isQuizFunnel)).toHaveLength(1);
  });

  it("keeps one column per other stage, in stage order", () => {
    expect(cols.slice(1).map(c => c.id)).toEqual(STAGES.filter(s => !s.isQuizStage).map(s => s.stage));
    expect(cols.slice(1).every(c => c.stages.length === 1 && !c.isQuizFunnel)).toBe(true);
  });

  it("covers every stage exactly once", () => {
    const all = cols.flatMap(c => c.stages);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(STAGES.map(s => s.stage).sort());
  });
});

describe("groupByColumn", () => {
  it("puts quiz-stage leads in the funnel and others in their stage column", () => {
    const leads = (["quiz_started", "snapshot_viewed", "new", "proposal", "quiz_completed", "lost"] as CRMStage[])
      .map((stage, i) => ({ id: `l${i}`, stage }));
    const g = groupByColumn(leads);
    expect(g.quiz.map(l => l.id)).toEqual(["l0", "l1", "l4"]);
    expect(g.new.map(l => l.id)).toEqual(["l2"]);
    expect(g.proposal.map(l => l.id)).toEqual(["l3"]);
    expect(g.lost.map(l => l.id)).toEqual(["l5"]);
    expect(g.won).toEqual([]);
  });
});

describe("isOpenDeal", () => {
  it("excludes quiz stages, won and lost", () => {
    expect(STAGES.filter(s => isOpenDeal(s.stage)).map(s => s.stage))
      .toEqual(["new", "qualification", "engaged", "call_demo_scheduled", "proposal"]);
  });
});

describe("dates", () => {
  it("counts days in stage from stage_entered_at, falling back to updated_at", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(daysInStage({ stage_entered_at: "2026-10-20T13:00:00Z", updated_at: "2026-10-24T00:00:00Z" }, now)).toBe(3);
    expect(daysInStage({ stage_entered_at: null, updated_at: "2026-10-22T12:00:00Z" }, now)).toBe(2);
  });

  it("classifies and labels due dates", () => {
    const today = "2026-10-24";
    expect(dueState(null, today)).toBe("none");
    expect(dueState("2026-10-22", today)).toBe("late");
    expect(dueState("2026-10-24", today)).toBe("today");
    expect(dueState("2026-10-25", today)).toBe("soon");
    expect(dueState("2026-11-02", today)).toBe("later");
    expect(dueLabel("2026-10-22", today)).toBe("2 days late");
    expect(dueLabel("2026-10-23", today)).toBe("1 day late");
    expect(dueLabel("2026-10-24", today)).toBe("Due today");
    expect(dueLabel("2026-10-25", today)).toBe("Due tomorrow");
    expect(dueLabel("2026-11-02", today)).toBe("Due Nov 2");
  });

  it("adds and diffs calendar days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(dayDiff("2026-10-30", "2026-11-02")).toBe(3);
  });
});

describe("progressLevel", () => {
  it("is the furthest step reached", () => {
    expect(progressLevel(undefined)).toBe(0);
    expect(progressLevel(NO_PROGRESS)).toBe(0);
    expect(progressLevel({ ...NO_PROGRESS, discovery: true })).toBe(1);
    expect(progressLevel({ ...NO_PROGRESS, discovery: true, scope: true, room: true })).toBe(3);
    expect(progressLevel({ ...NO_PROGRESS, delivery: true })).toBe(4);
  });
});
