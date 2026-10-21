import type { ScopeSection } from "./scope-client-view";

export type DiffLine = { type: "same" | "add" | "del"; text: string };
export type SectionDiff = { key: string; title: string; status: "added" | "removed" | "changed" | "unchanged"; lines: DiffLine[] };

const split = (s: string) => (s === "" ? [] : s.split("\n"));

/** Line diff via longest common subsequence. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = split(before), b = split(after);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "del", text: a[i++] });
    else out.push({ type: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });
  return out;
}

/** Per-section diff of body_md between a version and the one before it (matched by key). */
export function diffSections(prev: ScopeSection[] | null, next: ScopeSection[]): SectionDiff[] {
  const prevByKey = new Map((prev ?? []).map((s) => [s.key, s]));
  const out: SectionDiff[] = [];
  for (const s of next) {
    const p = prevByKey.get(s.key);
    prevByKey.delete(s.key);
    if (!p) out.push({ key: s.key, title: s.title, status: "added", lines: diffLines("", s.body_md) });
    else {
      const lines = diffLines(p.body_md, s.body_md);
      out.push({ key: s.key, title: s.title, status: lines.some((l) => l.type !== "same") ? "changed" : "unchanged", lines });
    }
  }
  for (const p of prevByKey.values()) out.push({ key: p.key, title: p.title, status: "removed", lines: diffLines(p.body_md, "") });
  return out;
}
