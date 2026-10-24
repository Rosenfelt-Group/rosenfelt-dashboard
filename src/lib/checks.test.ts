import { describe, it, expect } from "vitest";
import { checksConfig } from "./checks";

describe("checksConfig", () => {
  it("needs both CHECKS_URL and CHECKS_WEBHOOK_SECRET, with no fallback to an agent secret", () => {
    expect(checksConfig({ CHECKS_URL: "https://checks.test/", CHECKS_WEBHOOK_SECRET: "s" })).toEqual({ url: "https://checks.test", secret: "s" });
    expect(checksConfig({ CHECKS_URL: "https://checks.test" })).toBeNull();
    expect(checksConfig({ CHECKS_URL: "https://checks.test", JORDAN_WEBHOOK_SECRET: "j", CASEY_WEBHOOK_SECRET: "c" })).toBeNull();
    expect(checksConfig({ CHECKS_WEBHOOK_SECRET: "s" })).toBeNull();
  });
  it("is never a dispatch target", async () => {
    const { isAgent } = await import("./agent-urls");
    expect(isAgent("checks")).toBe(false);
  });
});
