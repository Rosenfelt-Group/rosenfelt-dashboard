import { describe, expect, it } from "vitest";
import { parseNextStep } from "./next-step";

describe("parseNextStep", () => {
  it("leaves absent keys absent", () => {
    expect(parseNextStep({ stage: "new" })).toEqual({ ok: true, patch: {} });
  });

  it("trims the step and clears with empty values", () => {
    expect(parseNextStep({ next_step: "  Call Ruth ", next_step_due: "2026-10-30" }))
      .toEqual({ ok: true, patch: { next_step: "Call Ruth", next_step_due: "2026-10-30" } });
    expect(parseNextStep({ next_step: "   ", next_step_due: "" })).toEqual({ ok: true, patch: { next_step: null, next_step_due: null } });
    expect(parseNextStep({ next_step: null, next_step_due: null })).toEqual({ ok: true, patch: { next_step: null, next_step_due: null } });
  });

  it("rejects bad values", () => {
    expect(parseNextStep({ next_step: 5 }).ok).toBe(false);
    expect(parseNextStep({ next_step: "x".repeat(501) }).ok).toBe(false);
    expect(parseNextStep({ next_step_due: "tomorrow" }).ok).toBe(false);
    expect(parseNextStep({ next_step_due: "2026-02-30" }).ok).toBe(false);
  });
});
