import { describe, it, expect } from "vitest";
import { RefreshAccessSchema } from "./schemas";

describe("RefreshAccessSchema", () => {
  it("defaults to 60 days and bounds the range", () => {
    expect(RefreshAccessSchema.parse({})).toEqual({ expires_days: 60 });
    expect(RefreshAccessSchema.safeParse({ expires_days: 0 }).success).toBe(false);
    expect(RefreshAccessSchema.safeParse({ expires_days: 366 }).success).toBe(false);
    expect(RefreshAccessSchema.safeParse({ expires_days: 1.5 }).success).toBe(false);
  });
});
