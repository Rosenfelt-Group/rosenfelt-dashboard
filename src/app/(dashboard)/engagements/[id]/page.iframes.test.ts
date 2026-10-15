import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Static guard: a one-line slip on either iframe must fail a test.
const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
const tags = src.match(/<iframe\b[^>]*>/g) ?? [];

describe("engagement page iframes", () => {
  it("renders exactly two iframes", () => {
    expect(tags).toHaveLength(2);
  });
  it("sandboxes the prototype iframe with exactly allow-scripts allow-forms", () => {
    const t = tags.find(x => x.includes('title="Prototype preview"'))!;
    expect(t).toBeDefined();
    expect(t).toContain('sandbox="allow-scripts allow-forms"');
    expect(t).toContain('referrerPolicy="no-referrer"');
  });
  it("leaves the document iframe unsandboxed (PDF viewer) but with no referrer", () => {
    const t = tags.find(x => x.includes('title="Document preview"'))!;
    expect(t).toBeDefined();
    expect(t).not.toMatch(/sandbox/i);
    expect(t).toContain('referrerPolicy="no-referrer"');
  });
});
