import { describe, it, expect } from "vitest";
import { canSendApproval } from "./approvals-send";

describe("canSendApproval (R38)", () => {
  const base = { action_type: "email_send", status: "approved", executed_at: null };
  it("shows for approved, never-executed email_send", () => expect(canSendApproval(base)).toBe(true));
  it("treats undefined executed_at as not executed", () => expect(canSendApproval({ ...base, executed_at: undefined })).toBe(true));
  it("hides once executed", () => expect(canSendApproval({ ...base, executed_at: "2026-01-01T00:00:00Z" })).toBe(false));
  it("hides for other statuses and types", () => {
    for (const status of ["pending", "executing", "done", "failed", "rejected"]) expect(canSendApproval({ ...base, status })).toBe(false);
    expect(canSendApproval({ ...base, action_type: "publish_post" })).toBe(false);
  });
});

import { executeFailureMessage } from "./approvals-send";
describe("executeFailureMessage", () => {
  it("explains a skipped execute", () => {
    expect(executeFailureMessage({ status: "skipped" }, 409)).toBe("Not sent: this approval was already executed or is not approved.");
  });
  it("shows errors and falls back to HTTP status", () => {
    expect(executeFailureMessage({ status: "failed", error: "boom" }, 200)).toBe("Email NOT sent: boom");
    expect(executeFailureMessage(null, 500)).toBe("Email NOT sent: HTTP 500");
  });
});
