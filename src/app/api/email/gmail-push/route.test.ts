import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { fakeDb as db } from "@/lib/email/test-supabase";

vi.mock("@/lib/supabase-admin", async () => ({ supabaseAdmin: (await import("@/lib/email/test-supabase")).fakeDb.supabaseAdmin }));

const gm = vi.hoisted(() => ({ getHistory: vi.fn(), getMessage: vi.fn(), listMessages: vi.fn(), watch: vi.fn() }));
vi.mock("@/lib/email/gmail-user", async (orig) => ({ ...(await orig<object>()), gmailRead: () => gm }));

const ing = vi.hoisted(() => ({ classify: vi.fn(), loadContactsByEmail: vi.fn(), planIngest: vi.fn(), applyIngest: vi.fn() }));
vi.mock("@/lib/email/ingest", () => ing);

const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/push-auth", () => ({ verifyPushToken: (...a: unknown[]) => verify(...a) }));

import { POST } from "./route";
import { GmailUserError } from "@/lib/email/gmail-user";

const push = (historyId: string, auth: string | null = "Bearer tok") =>
  ({
    headers: new Headers(auth ? { authorization: auth } : {}),
    json: async () => ({ message: { data: Buffer.from(JSON.stringify({ emailAddress: "brian@rosably.com", historyId })).toString("base64") } }),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  db.state.row = { history_id: "100", watch_expiration: null, last_full_sync_at: null };
  db.state.logs = [];
  verify.mockResolvedValue(true);
  gm.getMessage.mockImplementation(async (id: string) => ({ id }));
  ing.classify.mockReturnValue({ participants: ["x@y.org"] });
  ing.loadContactsByEmail.mockResolvedValue(new Map());
  ing.planIngest.mockReturnValue({ kind: "log", links: [] });
  ing.applyIngest.mockResolvedValue(undefined);
});

describe("POST /api/email/gmail-push", () => {
  it("rejects_bad_oidc", async () => {
    verify.mockResolvedValue(false);
    expect((await POST(push("101"))).status).toBe(401);
    expect((await POST(push("101", null))).status).toBe(401);
    expect(gm.getHistory).not.toHaveBeenCalled();
  });

  it("processes_history_and_advances_cursor", async () => {
    gm.getHistory.mockResolvedValue({ historyId: "150", addedMessageIds: ["a", "b"] });
    const res = await POST(push("150"));
    expect(res.status).toBe(204);
    expect(gm.getHistory).toHaveBeenCalledWith("100", undefined);
    expect(ing.applyIngest).toHaveBeenCalledTimes(2);
    expect(db.state.row.history_id).toBe("150");
  });

  it("first run stores the push historyId and processes nothing", async () => {
    db.state.row.history_id = null;
    expect((await POST(push("500"))).status).toBe(204);
    expect(db.state.row.history_id).toBe("500");
    expect(gm.getHistory).not.toHaveBeenCalled();
  });

  it("duplicate_notification_no_double_log", async () => {
    gm.getHistory.mockResolvedValueOnce({ historyId: "150", addedMessageIds: ["a"] }).mockResolvedValueOnce({ historyId: "150", addedMessageIds: [] });
    await POST(push("150"));
    await POST(push("150"));
    expect(ing.applyIngest).toHaveBeenCalledTimes(1);
    expect(db.state.row.history_id).toBe("150");
  });

  it("out_of_order_notification_keeps_max_history_id", async () => {
    db.state.row.history_id = "9000";
    gm.getHistory.mockResolvedValue({ historyId: "999", addedMessageIds: [] }); // "999" > "9000" as strings, but not numerically
    await POST(push("999"));
    expect(db.state.row.history_id).toBe("9000");
    gm.getHistory.mockResolvedValue({ historyId: "10000", addedMessageIds: [] });
    await POST(push("10000"));
    expect(db.state.row.history_id).toBe("10000");
  });

  it("history_too_old_triggers_7d_resync", async () => {
    gm.getHistory.mockRejectedValue(new GmailUserError("api_error", "Gmail GET /history failed (404)", 404));
    gm.listMessages.mockResolvedValueOnce({ ids: ["m1", "m2"], nextPageToken: "n" }).mockResolvedValueOnce({ ids: ["m3"] });
    const res = await POST(push("777"));
    expect(res.status).toBe(204);
    expect(gm.listMessages).toHaveBeenNthCalledWith(1, "newer_than:7d", undefined);
    expect(gm.listMessages).toHaveBeenNthCalledWith(2, "newer_than:7d", "n");
    expect(ing.applyIngest).toHaveBeenCalledTimes(3);
    expect(db.state.row.history_id).toBe("777");
    expect(db.state.row.last_full_sync_at).toBeTruthy();
  });

  it("caps at 200 messages and does not advance the cursor", async () => {
    gm.getHistory.mockResolvedValue({ historyId: "900", addedMessageIds: Array.from({ length: 250 }, (_, i) => `m${i}`) });
    expect((await POST(push("900"))).status).toBe(204);
    expect(ing.applyIngest).toHaveBeenCalledTimes(200);
    expect(db.state.row.history_id).toBe("100");
  });

  it("errors_logged_and_acked", async () => {
    gm.getHistory.mockRejectedValue(new Error("boom"));
    const res = await POST(push("150"));
    expect(res.status).toBe(204);
    expect(db.state.logs).toHaveLength(1);
    expect(db.state.logs[0]).toMatchObject({ workflow_name: "gmail-push", status: "error", error_message: expect.stringContaining("boom") });
    expect(db.state.row.history_id).toBe("100");
  });

  it("acks and logs when a message fails, without advancing", async () => {
    gm.getHistory.mockResolvedValue({ historyId: "150", addedMessageIds: ["a"] });
    ing.applyIngest.mockRejectedValue(new Error("db down"));
    expect((await POST(push("150"))).status).toBe(204);
    expect(db.state.logs[0]).toMatchObject({ status: "error" });
    expect(db.state.row.history_id).toBe("100");
  });
});
