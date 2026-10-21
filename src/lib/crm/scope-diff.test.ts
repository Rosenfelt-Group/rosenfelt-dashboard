import { describe, expect, it } from "vitest";
import { diffLines, diffLinesEx, diffSections } from "./scope-diff";

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

describe("diff size guard", () => {
  it("large_section_falls_back_without_hang", () => {
    const a = Array.from({ length: 20000 }, (_, i) => `old ${i}`).join("\n");
    const b = Array.from({ length: 20000 }, (_, i) => `new ${i}`).join("\n");
    const t0 = performance.now();
    const r = diffLinesEx(a, b);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.tooLarge).toBe(true);
    expect(r.lines.filter((l) => l.type === "del")).toHaveLength(20000);
    expect(r.lines.filter((l) => l.type === "add")).toHaveLength(20000);
  });
  it("trims common prefix and suffix so a small edit in a big section still diffs", () => {
    const body = (mid: string) => [...Array.from({ length: 20000 }, (_, i) => `p${i}`), mid, ...Array.from({ length: 20000 }, (_, i) => `s${i}`)].join("\n");
    const r = diffLinesEx(body("old"), body("new"));
    expect(r.tooLarge).toBe(false);
    expect(r.lines.filter((l) => l.type !== "same")).toEqual([{ type: "del", text: "old" }, { type: "add", text: "new" }]);
  });
  it("handles duplicate lines", () => {
    expect(diffLines("a\na\na", "a\na")).toEqual([{ type: "same", text: "a" }, { type: "same", text: "a" }, { type: "del", text: "a" }]);
    expect(diffLines("x\na\na\ny", "x\na\ny")).toEqual([
      { type: "same", text: "x" }, { type: "same", text: "a" }, { type: "del", text: "a" }, { type: "same", text: "y" },
    ]);
  });
});
