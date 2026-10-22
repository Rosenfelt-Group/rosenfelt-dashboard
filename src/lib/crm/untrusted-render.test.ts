import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Email bodies are untrusted: they must only ever be rendered as React text.
const DIRS = ["src/app/(dashboard)/crm/people", "src/app/(dashboard)/crm/inbox", "src/components/crm"];
function files(dir: string): string[] {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : []; });
}
describe("email rendering", () => {
  const list = DIRS.flatMap(files);
  it("finds the UI files", () => expect(list.length).toBeGreaterThan(2));
  for (const f of list) {
    it(`${f} never injects HTML`, () => {
      expect(readFileSync(f, "utf8")).not.toMatch(/dangerouslySetInnerHTML|innerHTML|\.outerHTML|insertAdjacentHTML/);
    });
  }
});
