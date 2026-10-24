import { describe, expect, it } from "vitest";
import { contactSearchFilter, ilikeAny, MAX_QUERY, parseLimit, parseSearchQuery } from "./search";

describe("parseSearchQuery", () => {
  it("trims and collapses whitespace", () => {
    expect(parseSearchQuery("  harbor   light ")).toBe("harbor light");
  });

  it("returns null for missing or too-short input", () => {
    expect(parseSearchQuery(null)).toBeNull();
    expect(parseSearchQuery(undefined)).toBeNull();
    expect(parseSearchQuery("")).toBeNull();
    expect(parseSearchQuery(" a ")).toBeNull();
    expect(parseSearchQuery("()")).toBeNull();
  });

  it("drops characters that would change a PostgREST or() filter", () => {
    const q = parseSearchQuery('a,b(c)d*e%f"g\\h:i')!;
    expect(q).toBe("a b c d e f g h i");
    expect(q).not.toMatch(/[,()*%"\\:]/);
  });

  it("keeps email, domain and name punctuation", () => {
    expect(parseSearchQuery("dana@harbor-light.org")).toBe("dana@harbor-light.org");
    expect(parseSearchQuery("O'Brien & Sons")).toBe("O'Brien & Sons");
    expect(parseSearchQuery("Zoë Müller")).toBe("Zoë Müller");
  });

  it("caps the length", () => {
    expect(parseSearchQuery("x".repeat(500))).toHaveLength(MAX_QUERY);
  });

  it("an injected filter cannot add a condition", () => {
    const q = parseSearchQuery("x,deleted_at.not.is.null")!;
    expect(ilikeAny(["name"], q)).toBe("name.ilike.*x deleted_at.not.is.null*");
  });
});

describe("parseLimit", () => {
  it("uses the fallback for missing or invalid values", () => {
    for (const raw of [null, undefined, "", "0", "-3", "2.5", "abc"]) expect(parseLimit(raw, 5, 20)).toBe(5);
  });
  it("clamps to the maximum", () => {
    expect(parseLimit("8", 5, 20)).toBe(8);
    expect(parseLimit("999", 5, 20)).toBe(20);
  });
});

describe("filters", () => {
  it("ilikeAny ORs a contains match per column", () => {
    expect(ilikeAny(["name", "website"], "harbor")).toBe("name.ilike.*harbor*,website.ilike.*harbor*");
  });

  it("contactSearchFilter matches one word on any name or the email", () => {
    expect(contactSearchFilter("dana")).toBe("first_name.ilike.*dana*,last_name.ilike.*dana*,email.ilike.*dana*");
  });

  it("contactSearchFilter also splits a full name across first and last", () => {
    expect(contactSearchFilter("dana van whit")).toContain("and(first_name.ilike.*dana*,last_name.ilike.*van whit*)");
  });
});
