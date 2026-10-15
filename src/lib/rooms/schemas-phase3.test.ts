import { describe, it, expect } from "vitest";
import { RefreshAccessSchema, DeliverablePatchSchema, normalizeWelcome } from "./schemas";

describe("RefreshAccessSchema", () => {
  it("defaults to 60 days and bounds the range", () => {
    expect(RefreshAccessSchema.parse({})).toEqual({ expires_days: 60 });
    expect(RefreshAccessSchema.safeParse({ expires_days: 0 }).success).toBe(false);
    expect(RefreshAccessSchema.safeParse({ expires_days: 366 }).success).toBe(false);
    expect(RefreshAccessSchema.safeParse({ expires_days: 1.5 }).success).toBe(false);
  });
});

describe("welcome message", () => {
  it("normalizes line endings, strips control characters, trims, and maps empty to null", () => {
    expect(normalizeWelcome("  Hi\r\nthere\rfriend\u0007  ")).toBe("Hi\nthere\nfriend");
    expect(normalizeWelcome("   \n\t ")).toBeNull();
    expect(normalizeWelcome(null)).toBeNull();
    expect(normalizeWelcome("tab\tkept")).toBe("tab\tkept");
  });
  it("keeps markup as literal text (it is rendered as text, never HTML)", () => {
    expect(DeliverablePatchSchema.parse({ welcome_message: "<b>hi</b><script>x</script>" })).toEqual({ welcome_message: "<b>hi</b><script>x</script>" });
  });
  it("accepts 1000 characters and rejects 1001", () => {
    expect(DeliverablePatchSchema.safeParse({ welcome_message: "x".repeat(1000) }).success).toBe(true);
    expect(DeliverablePatchSchema.safeParse({ welcome_message: "x".repeat(1001) }).success).toBe(false);
  });
  it("rejects unknown keys and wrong types", () => {
    expect(DeliverablePatchSchema.safeParse({ welcome_message: "x", title: "y" }).success).toBe(false);
    expect(DeliverablePatchSchema.safeParse({ welcome_message: 5 }).success).toBe(false);
    expect(DeliverablePatchSchema.safeParse({}).success).toBe(false);
  });
  it("turns whitespace-only into null and rejects other non-strings", () => {
    expect(DeliverablePatchSchema.parse({ welcome_message: " \r\n\t " })).toEqual({ welcome_message: null });
    expect(DeliverablePatchSchema.parse({ welcome_message: null })).toEqual({ welcome_message: null });
    for (const v of [true, [], {}, undefined]) {
      expect(DeliverablePatchSchema.safeParse({ welcome_message: v }).success).toBe(false);
    }
  });
  it("counts the limit after CRLF normalization and trimming", () => {
    expect(DeliverablePatchSchema.safeParse({ welcome_message: "a\r\n".repeat(499) + "ab" }).success).toBe(true);
    expect(DeliverablePatchSchema.safeParse({ welcome_message: " " + "x".repeat(1000) + " " }).success).toBe(true);
  });
});
