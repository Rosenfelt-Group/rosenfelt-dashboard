import type { ScopeSection } from "./scope-client-view";

export type DiffLine = { type: "same" | "add" | "del"; text: string };
export type SectionDiff = { key: string; title: string; status: "added" | "removed" | "changed" | "unchanged"; lines: DiffLine[]; tooLarge: boolean };

const split = (s: string) => (s === "" ? [] : s.split("\n"));

export const MAX_DIFF_CELLS = 4_000_000;
export type LineDiff = { lines: DiffLine[]; tooLarge: boolean };

/** Line diff via longest common subsequence, after trimming the common prefix and suffix. */
export function diffLinesEx(before: string, after: string): LineDiff {
  const a = split(before), b = split(after);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length, eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const head: DiffLine[] = a.slice(0, lo).map((text) => ({ type: "same", text }));
  const tail: DiffLine[] = a.slice(ea).map((text) => ({ type: "same", text }));
  const x = a.slice(lo, ea), y = b.slice(lo, eb);
  if (x.length * y.length > MAX_DIFF_CELLS) {
    return {
      tooLarge: true,
      lines: [...head, ...x.map((text): DiffLine => ({ type: "del", text })), ...y.map((text): DiffLine => ({ type: "add", text })), ...tail],
    };
  }
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const mid: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { mid.push({ type: "same", text: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) mid.push({ type: "del", text: x[i++] });
    else mid.push({ type: "add", text: y[j++] });
  }
  while (i < x.length) mid.push({ type: "del", text: x[i++] });
  while (j < y.length) mid.push({ type: "add", text: y[j++] });
  return { tooLarge: false, lines: [...head, ...mid, ...tail] };
}

export function diffLines(before: string, after: string): DiffLine[] {
  return diffLinesEx(before, after).lines;
}

/** Per-section diff of body_md between a version and the one before it (matched by key). */
export function diffSections(prev: ScopeSection[] | null, next: ScopeSection[]): SectionDiff[] {
  const prevByKey = new Map((prev ?? []).map((s) => [s.key, s]));
  const out: SectionDiff[] = [];
  for (const s of next) {
    const p = prevByKey.get(s.key);
    prevByKey.delete(s.key);
    if (!p) { const r = diffLinesEx("", s.body_md); out.push({ key: s.key, title: s.title, status: "added", ...r }); }
    else {
      const r = diffLinesEx(p.body_md, s.body_md);
      out.push({ key: s.key, title: s.title, status: r.lines.some((l) => l.type !== "same") ? "changed" : "unchanged", ...r });
    }
  }
  for (const p of prevByKey.values()) out.push({ key: p.key, title: p.title, status: "removed", ...diffLinesEx(p.body_md, "") });
  return out;
}
