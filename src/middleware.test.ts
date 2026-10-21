import { describe, it, expect } from "vitest";
import { config } from "./middleware";

const matches = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe("middleware matcher", () => {
  it("excludes the gmail push and watch cron routes (prefix-safe)", () => {
    expect(matches("/api/email/gmail-push")).toBe(false);
    expect(matches("/api/email/gmail-push/")).toBe(false);
    expect(matches("/api/cron/gmail-watch")).toBe(false);
    expect(matches("/api/email/gmail-pushx")).toBe(true);
    expect(matches("/api/cron/gmail-watchx")).toBe(true);
    expect(matches("/api/email/other")).toBe(true);
    expect(matches("/api/intake")).toBe(false);
    expect(matches("/overview")).toBe(true);
  });
});
