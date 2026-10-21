import { describe, expect, it } from "vitest";
import { diffLines, diffSections } from "./scope-diff";

describe("diffLines", () => {
  it("marks unchanged, added and removed lines", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
    ]);
  });
  it("handles empty sides", () => {
    expect(diffLines("", "a\nb")).toEqual([{ type: "add", text: "a" }, { type: "add", text: "b" }]);
    expect(diffLines("a", "")).toEqual([{ type: "del", text: "a" }]);
    expect(diffLines("", "")).toEqual([]);
  });
});

describe("diffSections", () => {
  const s = (key: string, body_md: string) => ({ key, title: key, body_md, visibility: "client" as const });
  it("reports added, removed, changed and unchanged sections", () => {
    const out = diffSections([s("a", "1"), s("b", "2"), s("c", "3")], [s("a", "1"), s("b", "2x"), s("d", "4")]);
    expect(out.map((d) => [d.key, d.status])).toEqual([["a", "unchanged"], ["b", "changed"], ["d", "added"], ["c", "removed"]]);
    expect(out[1].lines).toEqual([{ type: "del", text: "2" }, { type: "add", text: "2x" }]);
  });
  it("treats everything as added with no previous version", () => {
    expect(diffSections(null, [s("a", "1")])[0].status).toBe("added");
  });
});
