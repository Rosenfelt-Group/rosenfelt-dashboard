import { describe, it, expect } from "vitest";
import { DiscoveryQuestion, DiscoveryQuestionnaireDef, DiscoveryTemplateItem } from "@/types";
import {
  DraftSnapshotSchema, NO_QUESTIONS_MESSAGE, SnapshotSchema, buildSnapshot, customKey, dependentsOf, dropDanglingShowIf, estimateMinutes,
  questionToField, resolveSnapshot, visibleSections,
} from "./snapshot";
import { cleanQuestion, questionFromField, QuestionInputSchema } from "./bank";
import { isFieldVisible } from "./index";

const q = (key: string, over: Partial<DiscoveryQuestion> = {}): DiscoveryQuestion => ({
  id: `q-${key}`, key, label: `Label ${key}`, section: "General", type: "text", required: false, config: {}, ...over,
});
const item = (question: DiscoveryQuestion, position: number, section_id: string, over: Partial<DiscoveryTemplateItem> = {}) =>
  ({ question_id: question.id, position, section_id, question, ...over });

const template = {
  id: "t1", name: "Standard Discovery", intro_text: "Hello", estimated_minutes: 15,
  sections: [{ id: "a", title: "First" }, { id: "b", title: "Second", intro: "About b" }, { id: "c", title: "Content only" }],
};

describe("buildSnapshot", () => {
  const choice = q("tools", { type: "single", options: ["Yes", "No"], required: true });
  const follow = q("why", { type: "textarea" });
  const items = [
    item(follow, 2, "a", { show_if: { field: "tools", in: ["Yes"] } }),
    item(choice, 1, "a"),
    item(q("scale", { type: "scale", config: { minLabel: "Low" } }), 3, "b", { required: true }),
    item(q("posts"), 4, "c", { project_types: ["content_social"] }),
  ];

  it("orders by position, groups by section and keeps showIf", () => {
    const s = buildSnapshot(template, items, "content_social");
    expect(s.sections.map(x => x.id)).toEqual(["a", "b", "c"]);
    expect(s.sections[0].fields.map(f => f.id)).toEqual(["tools", "why"]);
    expect(s.sections[0].fields[1].showIf).toEqual({ field: "tools", in: ["Yes"] });
    expect(s.sections[1].intro).toBe("About b");
    expect(s.intro).toBe("Hello");
    expect(s.template).toEqual({ id: "t1", name: "Standard Discovery" });
    expect(SnapshotSchema.safeParse(s).success).toBe(true);
  });

  it("drops items for other project types and empty sections", () => {
    const s = buildSnapshot(template, items, "operations");
    expect(s.sections.map(x => x.id)).toEqual(["a", "b"]);
  });

  it("applies item overrides and scale defaults", () => {
    const s = buildSnapshot(template, items, "operations");
    const scale = s.sections[1].fields[0];
    expect(scale).toMatchObject({ id: "scale", type: "scale", required: true, min: 1, max: 5, minLabel: "Low" });
    const notRequired = questionToField(choice, { required: false, show_if: null });
    expect(notRequired.required).toBeUndefined();
  });

  it("puts items from a deleted section in a catch-all section", () => {
    const s = buildSnapshot(template, [item(q("lost"), 1, "gone")], "other");
    expect(s.sections).toEqual([{ id: "more", title: "More questions", fields: [expect.objectContaining({ id: "lost" })] }]);
  });

  it("drops a showIf whose target question is not in the snapshot", () => {
    const s = buildSnapshot(template, [item(follow, 1, "a", { show_if: { field: "tools", in: ["Yes"] } })], "other");
    expect(s.sections[0].fields[0].showIf).toBeUndefined();
  });
});

// A v1-shaped snapshot, as backfilled onto invites that predate templates.
const v1: DiscoveryQuestionnaireDef = {
  version: "v1", title: "Discovery questionnaire", estimated_minutes: 15,
  project_types: { content_social: "Content & social media", operations: "Operations" },
  sections: [
    { id: "project", title: "Your project", fields: [{ id: "project_confirm", type: "single", label: "Accurate?", options: ["Yes", "No"] }] },
    { id: "workflow_content", title: "Content", modules: ["content_social"], fields: [{ id: "channels", type: "multi", label: "Channels", options: ["IG"] }] },
    { id: "workflow_general", title: "Process", modules: ["operations", "other"], fields: [{ id: "process_steps", type: "textarea", label: "Steps" }] },
  ],
};

describe("blank template", () => {
  const blank = { id: "t-blank", name: "Blank: custom questions", intro_text: "Hi", estimated_minutes: 5, sections: [{ id: "questions", title: "Questions" }] };

  it("keeps the empty section so the draft has somewhere to add questions", () => {
    const s = buildSnapshot(blank, [], "other");
    expect(s.sections).toEqual([{ id: "questions", title: "Questions", fields: [] }]);
    expect(s.template).toEqual({ id: "t-blank", name: "Blank: custom questions" });
  });

  it("falls back to a Questions section when the template has none", () => {
    expect(buildSnapshot({ ...blank, sections: [] }, [], "other").sections).toEqual([{ id: "questions", title: "Questions", fields: [] }]);
  });

  it("still drops sections emptied by project-type filtering", () => {
    const s = buildSnapshot(template, [item(q("x"), 1, "a"), item(q("y"), 2, "c", { project_types: ["content_social"] })], "other");
    expect(s.sections.map(x => x.id)).toEqual(["a"]);
  });

  it("can be saved as a draft but not sent", () => {
    const s = buildSnapshot(blank, [], "other");
    expect(DraftSnapshotSchema.safeParse(s).success).toBe(true);
    const sent = SnapshotSchema.safeParse(s);
    expect(sent.success).toBe(false);
    expect(sent.error?.issues[0]?.message).toBe(NO_QUESTIONS_MESSAGE);
  });
});

describe("legacy (v1) snapshots", () => {
  it("filters sections by the invite's project type", () => {
    expect(visibleSections(v1, "content_social").map(s => s.id)).toEqual(["project", "workflow_content"]);
    expect(visibleSections(v1, "other").map(s => s.id)).toEqual(["project", "workflow_general"]);
    expect(visibleSections(null, "other")).toEqual([]);
  });

  it("prefers the invite snapshot and falls back to the response copy", () => {
    const other = { ...v1, version: "older" };
    expect(resolveSnapshot({ questionnaire_snapshot: v1, response: { schema_snapshot: other } as never })?.version).toBe("v1");
    expect(resolveSnapshot({ questionnaire_snapshot: null, response: { schema_snapshot: other } as never })?.version).toBe("older");
    expect(resolveSnapshot({ questionnaire_snapshot: null, response: undefined })).toBeNull();
  });

  it("validates as a snapshot", () => {
    expect(SnapshotSchema.safeParse(v1).success).toBe(true);
  });
});

describe("editing helpers", () => {
  const def: DiscoveryQuestionnaireDef = {
    version: "x", title: "t",
    sections: [{ id: "a", title: "A", fields: [
      { id: "ai_tools", type: "multi", label: "AI", options: ["None", "ChatGPT"] },
      { id: "ai_uses", type: "textarea", label: "Uses", showIf: { field: "ai_tools", notIn: ["None"] } },
    ] }],
  };

  it("finds questions that depend on another", () => {
    expect(dependentsOf(def, "ai_tools").map(f => f.id)).toEqual(["ai_uses"]);
    expect(dependentsOf(def, "ai_uses")).toEqual([]);
  });

  it("drops conditions when their target is removed", () => {
    const removed = { ...def, sections: [{ ...def.sections[0], fields: [def.sections[0].fields[1]] }] };
    expect(dropDanglingShowIf(removed).sections[0].fields[0].showIf).toBeUndefined();
    expect(dropDanglingShowIf(def).sections[0].fields[1].showIf).toBeDefined();
  });

  it("makes unique custom keys", () => {
    expect(customKey("What's your budget?", [])).toBe("custom_what_s_your_budget");
    const k = customKey("What's your budget?", ["custom_what_s_your_budget"], () => "ab12");
    expect(k).toBe("custom_what_s_your_budget_ab12");
    expect(customKey("¿?", [])).toBe("custom_item");
  });

  it("rejects duplicate keys, empty questionnaires and option-less choices", () => {
    const dup = { ...def, sections: [{ ...def.sections[0], fields: [def.sections[0].fields[0], def.sections[0].fields[0]] }] };
    expect(SnapshotSchema.safeParse(dup).success).toBe(false);
    expect(SnapshotSchema.safeParse({ ...def, sections: [] }).success).toBe(false);
    const noOpts = { ...def, sections: [{ id: "a", title: "A", fields: [{ id: "pick", type: "single", label: "Pick" }] }] };
    expect(SnapshotSchema.safeParse(noOpts).success).toBe(false);
  });

  it("estimates minutes", () => {
    expect(estimateMinutes(def)).toBe(3);
  });
});

describe("yes_no follow-up visibility", () => {
  it("is a regular field; the follow-up answer lives under <key>__detail", () => {
    const f = { id: "sensitive", type: "yes_no" as const, label: "Sensitive?", followUpOn: "Yes", followUpLabel: "What kind?" };
    expect(isFieldVisible(f, {})).toBe(true);
    expect(SnapshotSchema.safeParse({ version: "x", title: "t", sections: [{ id: "a", title: "A", fields: [f] }] }).success).toBe(true);
  });
});

describe("bank", () => {
  it("turns a one-off field into a bank question", () => {
    const b = questionFromField({ id: "custom_budget", type: "single", label: "Budget?", options: ["Low", "Low", "High"], required: true, other: true, showIf: { field: "x" } }, "Money");
    expect(b).toMatchObject({ key: "custom_budget", type: "single", section: "Money", options: ["Low", "High"], required: true, config: { other: true } });
    expect(b.config).not.toHaveProperty("showIf");
    expect(QuestionInputSchema.safeParse(b).success).toBe(true);
  });

  it("strips settings that don't apply to the type", () => {
    const c = cleanQuestion({ type: "text", label: "x", section: "s", required: false, options: ["a"], config: { other: true, followUpOn: "Yes", max: 3, minLabel: "lo" } });
    expect(c.options).toBeNull();
    expect(c.config).toEqual({});
    const s = cleanQuestion({ type: "scale", label: "x", section: "s", required: false, config: { min: 1, max: 5, minLabel: "lo" } });
    expect(s.config).toEqual({ min: 1, max: 5, minLabel: "lo" });
  });

  it("requires options for choice types", () => {
    expect(QuestionInputSchema.safeParse({ type: "multi", label: "Pick", options: [] }).success).toBe(false);
    expect(QuestionInputSchema.safeParse({ type: "yes_no", label: "Ok?" }).success).toBe(true);
  });
});
