import { describe, it, expect } from "vitest";
import { targetAfterPrep } from "./doc-limits";

describe("targetAfterPrep", () => {
  it("adopts the deliverable created by a new-document prep so a retry reuses it", () => {
    expect(targetAfterPrep("", "new-id")).toBe("new-id");
  });
  it("keeps an explicitly chosen target", () => {
    expect(targetAfterPrep("chosen", "chosen")).toBe("chosen");
  });
});
