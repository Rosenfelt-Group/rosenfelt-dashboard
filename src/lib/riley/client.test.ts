import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { draftQuestionnaire, requestBrief, requestDraftReply, RileyNotConfiguredError } from "./client";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.RILEY_AGENT_URL = "https://riley.example/";
  process.env.RILEY_DISCOVERY_SECRET = "disc-secret";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("riley discovery client", () => {
  it("fails closed when the URL or the secret is unset, without a request", async () => {
    delete process.env.RILEY_DISCOVERY_SECRET;
    await expect(draftQuestionnaire(ID)).rejects.toBeInstanceOf(RileyNotConfiguredError);
    process.env.RILEY_DISCOVERY_SECRET = "";
    await expect(requestBrief(ID)).rejects.toBeInstanceOf(RileyNotConfiguredError);
    process.env.RILEY_DISCOVERY_SECRET = "s";
    delete process.env.RILEY_AGENT_URL;
    await expect(draftQuestionnaire(ID)).rejects.toBeInstanceOf(RileyNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts invite_id with the secret header to the right path", async () => {
    fetchMock.mockResolvedValue(json(200, { sections: [], added_custom: 2 }));
    const r = await draftQuestionnaire(ID);
    expect(r).toEqual({ ok: true, data: { sections: [], added_custom: 2 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://riley.example/discovery/draft-questionnaire");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Webhook-Secret"]).toBe("disc-secret");
    expect(JSON.parse(init.body)).toEqual({ invite_id: ID });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("brief hits /discovery/brief", async () => {
    fetchMock.mockResolvedValue(json(200, { status: "ready", brief_id: "b", scope_version_id: null, fit_verdict: "strong" }));
    const r = await requestBrief(ID);
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://riley.example/discovery/brief");
  });

  it.each([
    [404, "not_found"], [409, "conflict"], [422, "invalid"], [500, "failed"], [502, "failed"], [401, "failed"], [503, "failed"],
  ])("maps HTTP %i to %s and hides the detail", async (status, kind) => {
    fetchMock.mockResolvedValue(json(status, { detail: "secret model text" }));
    const r = await requestBrief(ID);
    expect(r).toEqual({ ok: false, kind, status });
    expect(JSON.stringify(r)).not.toContain("secret model text");
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("disc-secret");
  });

  it("returns unreachable on network error and on timeout", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await draftQuestionnaire(ID)).toEqual({ ok: false, kind: "unreachable" });
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    expect(await requestBrief(ID)).toEqual({ ok: false, kind: "unreachable" });
  });

  it("uses 180s for the draft and 280s for the brief", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(json(200, { sections: [], added_custom: 0 }));
    await draftQuestionnaire(ID);
    fetchMock.mockResolvedValue(json(200, { status: "ready", brief_id: "b", scope_version_id: null, fit_verdict: null }));
    await requestBrief(ID);
    expect(spy.mock.calls.map(c => c[0])).toEqual([180_000, 280_000]);
  });

  it("treats a 200 with an unexpected body as failed", async () => {
    fetchMock.mockResolvedValue(json(200, { nope: 1 }));
    expect(await requestBrief(ID)).toMatchObject({ ok: false, kind: "failed" });
  });

  describe("requestDraftReply", () => {
    const MSG = "7a1b2c3d-0000-4000-8000-000000000001";
    it("fails closed when not configured, without a request", async () => {
      delete process.env.RILEY_DISCOVERY_SECRET;
      await expect(requestDraftReply(MSG, false)).rejects.toBeInstanceOf(RileyNotConfiguredError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("posts the message id and flag with the secret header and a 10s timeout", async () => {
      const spy = vi.spyOn(AbortSignal, "timeout");
      fetchMock.mockResolvedValue(json(200, { status: "drafted", approval_id: "a", summary: "s" }));
      const r = await requestDraftReply(MSG, true);
      expect(r).toEqual({ ok: true, data: { status: "drafted", approval_id: "a", summary: "s" } });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://riley.example/email/draft-reply");
      expect(init.method).toBe("POST");
      expect(init.headers["X-Webhook-Secret"]).toBe("disc-secret");
      expect(JSON.parse(init.body)).toEqual({ email_message_id: MSG, has_list_unsubscribe: true });
      expect(spy.mock.calls.map(c => c[0])).toEqual([10_000]);
    });
    it("accepts skipped / exists / no_reply bodies", async () => {
      for (const b of [{ status: "skipped", reason: "newsletter" }, { status: "exists" }, { status: "no_reply", summary: "x" }]) {
        fetchMock.mockResolvedValueOnce(json(200, b));
        expect(await requestDraftReply(MSG, false)).toMatchObject({ ok: true });
      }
    });
    it("reports a timeout as its own kind, other network errors as unreachable", async () => {
      fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
      expect(await requestDraftReply(MSG, false)).toEqual({ ok: false, kind: "timeout" });
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      expect(await requestDraftReply(MSG, false)).toEqual({ ok: false, kind: "unreachable" });
    });
    it("maps non-2xx to failed without leaking detail or the secret", async () => {
      fetchMock.mockResolvedValue(json(502, { detail: "reply draft failed: X" }));
      expect(await requestDraftReply(MSG, false)).toEqual({ ok: false, kind: "failed", status: 502 });
      expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("disc-secret");
    });
    it("rejects a 200 with an unexpected body", async () => {
      fetchMock.mockResolvedValue(json(200, { nope: 1 }));
      expect(await requestDraftReply(MSG, false)).toMatchObject({ ok: false, kind: "failed" });
    });
  });
});
