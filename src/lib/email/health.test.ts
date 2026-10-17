import { describe, expect, it } from "vitest";
import { computeHealth, type HealthInput } from "./health";

const base: HealthInput = {
  sent: 38,
  delivered: 38,
  unresolvedHardBounces: 0,
  unresolvedSpam: 0,
  bouncedTotal: 0,
  eventsInWindow: 37,
  postmarkError: null,
};
const run = (o: Partial<HealthInput>) => computeHealth({ ...base, ...o });

describe("computeHealth", () => {
  it("is green when all clear", () => {
    const h = run({});
    expect(h.level).toBe("green");
    expect(h.reasons).toEqual([]);
    expect(h.bounceRate).toBeCloseTo(0);
    expect(h.deliveredPct).toBeCloseTo(1);
  });

  it("is amber (not red) for one unresolved hard bounce under 50 sends", () => {
    const h = run({ sent: 20, delivered: 19, unresolvedHardBounces: 1, bouncedTotal: 1 });
    expect(h.level).toBe("amber");
  });

  it("is red when bounce rate exceeds 5% with 50+ sends", () => {
    const h = run({ sent: 60, delivered: 56, bouncedTotal: 4 });
    expect(h.level).toBe("red");
    expect(h.bounceRate).toBeCloseTo(4 / 60);
  });

  it("is amber when bounce rate is between 2% and 5% with 50+ sends", () => {
    expect(run({ sent: 60, delivered: 58, bouncedTotal: 2 }).level).toBe("amber");
  });

  it("is red for an unresolved spam complaint", () => {
    const h = run({ unresolvedSpam: 1 });
    expect(h.level).toBe("red");
    expect(h.reasons[0].toLowerCase()).toContain("spam");
  });

  it("is green when problems are all resolved", () => {
    expect(run({ sent: 20, delivered: 19, bouncedTotal: 1 }).level).toBe("green");
  });

  it("is red when Postmark rejected the token", () => {
    const h = run({ postmarkError: "auth" });
    expect(h.level).toBe("red");
    expect(h.reasons[0]).toContain("Postmark rejected the token");
  });

  it("is red when Postmark is unreachable, with null rates when sent is unknown", () => {
    const h = run({ postmarkError: "unreachable", sent: null, delivered: 0, eventsInWindow: 0 });
    expect(h.level).toBe("red");
    expect(h.reasons[0]).toContain("Can't reach Postmark");
    expect(h.bounceRate).toBeNull();
    expect(h.deliveredPct).toBeNull();
  });

  it("is amber when sends exist but no events arrived", () => {
    const h = run({ sent: 10, delivered: 10, eventsInWindow: 0 });
    expect(h.level).toBe("amber");
    expect(h.reasons[0]).toContain("alerts may be broken");
  });

  it("is green with no sends and no events", () => {
    const h = run({ sent: 0, delivered: 0, eventsInWindow: 0 });
    expect(h.level).toBe("green");
    expect(h.bounceRate).toBeNull();
  });

  it("lists red reasons before amber ones", () => {
    const h = run({ unresolvedSpam: 1, unresolvedHardBounces: 1 });
    expect(h.level).toBe("red");
    expect(h.reasons).toHaveLength(2);
    expect(h.reasons[0].toLowerCase()).toContain("spam");
  });
});
