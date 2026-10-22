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

const rec = (id: string, ...messageIds: string[]) => ({ id, messageIds });
const pg = (historyId: string, ...records: { id: string; messageIds: string[] }[]) => ({ historyId, addedMessageIds: records.flatMap((r) => r.messageIds), records });
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
    gm.getHistory.mockResolvedValue(pg("150", rec("120", "a"), rec("130", "b")));
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

  it("duplicate_notification_replays_same_plans_and_cursor_is_stable", async () => {
    gm.getHistory.mockResolvedValue(pg("150", rec("120", "a", "b")));
    ing.planIngest.mockImplementation((m: { id: string }) => ({ kind: "log", links: [{ contact_id: `c-${m.id}` }] }));
    await POST(push("150"));
    const first = ing.applyIngest.mock.calls.map((c) => c[0]);
    expect(db.state.row.history_id).toBe("150");
    ing.applyIngest.mockClear();
    await POST(push("150"));
    expect(ing.applyIngest.mock.calls.map((c) => c[0])).toEqual(first);
    expect(db.state.row.history_id).toBe("150");
    expect(db.state.logs).toHaveLength(0);
  });

  it("out_of_order_notification_keeps_max_history_id", async () => {
    db.state.row.history_id = "9000";
    gm.getHistory.mockResolvedValue(pg("999")); // "999" > "9000" as strings, but not numerically
    await POST(push("999"));
    expect(db.state.row.history_id).toBe("9000");
    gm.getHistory.mockResolvedValue(pg("10000"));
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

  it("cap_mid_burst_advances_to_last_complete_record_and_resumes", async () => {
    const recs = [1, 2, 3, 4, 5].map((n) => rec(String(100 + n * 10), ...Array.from({ length: 50 }, (_, i) => `m${n}-${i}`)));
    gm.getHistory.mockImplementation(async (start: string) => pg("900", ...recs.filter((r) => BigInt(r.id) > BigInt(start))));
    expect((await POST(push("900"))).status).toBe(204);
    expect(ing.applyIngest).toHaveBeenCalledTimes(200);
    expect(db.state.row.history_id).toBe("140");
    ing.applyIngest.mockClear();
    await POST(push("900"));
    expect(gm.getHistory).toHaveBeenLastCalledWith("140", undefined);
    expect(ing.applyIngest).toHaveBeenCalledTimes(50);
    expect(db.state.row.history_id).toBe("900");
  });

  it("failed_message_logged_and_skipped_cursor_advances", async () => {
    gm.getHistory.mockResolvedValue(pg("150", rec("120", "bad", "good")));
    ing.applyIngest.mockImplementation(async (_p: unknown, msg: { id: string }) => {
      if (msg.id === "bad") throw new Error("db down");
    });
    expect((await POST(push("150"))).status).toBe(204);
    expect(ing.applyIngest).toHaveBeenCalledTimes(2);
    expect(db.state.logs).toHaveLength(1);
    expect(db.state.logs[0]).toMatchObject({ workflow_name: "gmail-push", status: "error", error_message: expect.stringContaining("bad") });
    expect(db.state.row.history_id).toBe("150");
  });

  it("systemic_error_stops_run_and_keeps_cursor", async () => {
    gm.getHistory.mockResolvedValue(pg("150", rec("120", "a"), rec("130", "b")));
    gm.getMessage.mockRejectedValue(new GmailUserError("auth_failed", "Token refresh failed (401)", 401));
    expect((await POST(push("150"))).status).toBe(204);
    expect(gm.getMessage).toHaveBeenCalledTimes(1); // stopped, did not skip through the rest
    expect(db.state.row.history_id).toBe("100");
    expect(db.state.logs[0]).toMatchObject({ workflow_name: "gmail-push", status: "error" });
    gm.getMessage.mockReset().mockRejectedValue(new GmailUserError("api_error", "Gmail GET /messages/x failed (503)", 503));
    await POST(push("150"));
    expect(db.state.row.history_id).toBe("100");
  });

  it("history_401_does_not_resync_and_keeps_cursor", async () => {
    gm.getHistory.mockRejectedValue(new GmailUserError("api_error", "Gmail GET /history failed (401)", 401));
    expect((await POST(push("150"))).status).toBe(204);
    expect(gm.listMessages).not.toHaveBeenCalled();
    expect(db.state.row.history_id).toBe("100");
    expect(db.state.logs[0]).toMatchObject({ status: "error" });
  });

  it("time budget stops at a record boundary and advances to the last complete record", async () => {
    gm.getHistory.mockResolvedValue(pg("900", rec("110", "a"), rec("120", "b"), rec("130", "c")));
    let t = 0;
    gm.getMessage.mockImplementation(async (id: string) => { t += 100; return { id }; });
    const { processPush } = await import("@/lib/email/gmail-sync");
    await processPush("900", { now: () => t, budgetMs: 150 });
    expect(ing.applyIngest).toHaveBeenCalledTimes(2); // a (t=100), b (t=200 > 150 deadline) then stop before c
    expect(db.state.row.history_id).toBe("120");
  });

  it("resync truncation is logged", async () => {
    gm.getHistory.mockRejectedValue(new GmailUserError("api_error", "Gmail GET /history failed (404)", 404));
    gm.listMessages.mockResolvedValue({ ids: Array.from({ length: 200 }, (_, i) => `m${i}`), nextPageToken: "more" });
    await POST(push("777"));
    expect(ing.applyIngest).toHaveBeenCalledTimes(200);
    expect(db.state.logs.some((l) => String(l.error_message).includes("truncated"))).toBe(true);
    expect(db.state.row.history_id).toBe("777");
  });

  it("errors_logged_and_acked", async () => {
    gm.getHistory.mockRejectedValue(new Error("boom"));
    const res = await POST(push("150"));
    expect(res.status).toBe(204);
    expect(db.state.logs).toHaveLength(1);
    expect(db.state.logs[0]).toMatchObject({ workflow_name: "gmail-push", status: "error", error_message: expect.stringContaining("boom") });
    expect(db.state.row.history_id).toBe("100");
  });
});
