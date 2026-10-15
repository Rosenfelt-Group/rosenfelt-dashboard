import { describe, it, expect } from "vitest";
import { STAGES, stageMeta } from "./stages";

describe("STAGES", () => {
  it("places Call/Demo Scheduled after engaged and before proposal", () => {
    const order = STAGES.map(s => s.stage);
    const i = order.indexOf("call_demo_scheduled");
    expect(i).toBeGreaterThan(-1);
    expect(order[i - 1]).toBe("engaged");
    expect(order[i + 1]).toBe("proposal");
    expect(stageMeta("call_demo_scheduled")?.label).toBe("Call/Demo Scheduled");
  });

  it("has unique stage keys", () => {
    expect(new Set(STAGES.map(s => s.stage)).size).toBe(STAGES.length);
  });
});
