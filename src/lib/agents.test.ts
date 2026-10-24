import { describe, expect, it } from "vitest";
import { AGENT_DETAIL_TABS, AGENTS_INDEX_TABS, getAgentInfo, isAgentName, parseTab } from "./agents";

describe("isAgentName", () => {
  it("accepts the six agents", () => {
    for (const a of ["jordan", "riley", "avery", "casey", "sam", "pickle"]) expect(isAgentName(a)).toBe(true);
  });
  it("rejects unknown, cased or non-string names", () => {
    expect(isAgentName("brian")).toBe(false);
    expect(isAgentName("Jordan")).toBe(false);
    expect(isAgentName("")).toBe(false);
    expect(isAgentName(undefined)).toBe(false);
    expect(isAgentName("toString")).toBe(false);
  });
});

describe("getAgentInfo", () => {
  it("returns metadata for an agent", () => {
    expect(getAgentInfo("sam").label).toBe("Sam");
  });
  it("Casey is the prototype builder, with no chat", () => {
    expect(getAgentInfo("casey")).toMatchObject({ role: "Design and prototypes", chat: false });
    for (const a of ["jordan", "riley", "avery", "sam"] as const) expect(getAgentInfo(a).chat).toBe(true);
  });
  it("Dr. Pickle has a page but no chat, prompts or tool count", () => {
    expect(getAgentInfo("pickle")).toMatchObject({ label: "Dr. Pickle", chat: false, prompts: false, tools: null });
    expect(getAgentInfo("jordan").prompts).toBe(true);
  });
});

describe("parseTab", () => {
  it("returns a valid tab unchanged", () => {
    expect(parseTab("activity", AGENTS_INDEX_TABS)).toBe("activity");
    expect(parseTab("prompts", AGENT_DETAIL_TABS)).toBe("prompts");
  });
  it("falls back to the first tab", () => {
    expect(parseTab(null, AGENTS_INDEX_TABS)).toBe("agents");
    expect(parseTab("nope", AGENT_DETAIL_TABS)).toBe("status");
    expect(parseTab(undefined, AGENT_DETAIL_TABS)).toBe("status");
  });
});
