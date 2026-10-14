import { describe, it, expect, vi } from "vitest";
import { dispatchBeginWork, dispatchBaseUrl } from "./dispatch";

const ok = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

// The brief used "wi-1"; ids must now be UUIDs, so the tests use a real one.
const ID = "3f2b8c1e-5d4a-4b7e-9c10-2a6f8e0d1b34";

describe("dispatchBeginWork", () => {
  it("posts begin_work with notifications suppressed and forwards the cookie", async () => {
    const f = vi.fn(() => ok({ dispatched: true, agent: "casey", action: "begin_work" }));
    const r = await dispatchBeginWork("https://dash.example.com", ID, "session=abc", f as unknown as typeof fetch);
    expect(r).toEqual({ dispatched: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://dash.example.com/api/work/${ID}/dispatch`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).cookie).toBe("session=abc");
    expect(JSON.parse(init.body as string)).toEqual({ action: "begin_work", suppress_notify: true });
    expect(init.signal).toBeDefined();
  });

  it("reports an agent that did not accept the dispatch", async () => {
    const r = await dispatchBeginWork("https://d", ID, "", (() => ok({ dispatched: false })) as unknown as typeof fetch);
    expect(r.dispatched).toBe(false);
    expect(r.error).toContain("did not accept");
  });

  it("reports a non-OK response with its status", async () => {
    const r = await dispatchBeginWork("https://d", ID, "", (() => ok({ error: "x" }, 500)) as unknown as typeof fetch);
    expect(r).toEqual({ dispatched: false, error: "HTTP 500" });
  });

  it("never throws: network errors and non-JSON bodies become a failed result", async () => {
    const boom = (() => Promise.reject(new Error("socket hang up"))) as unknown as typeof fetch;
    expect(await dispatchBeginWork("https://d", ID, "", boom)).toEqual({ dispatched: false, error: "network error" });
    const html = (() => Promise.resolve(new Response("<html>login</html>", { status: 200 }))) as unknown as typeof fetch;
    expect((await dispatchBeginWork("https://d", ID, "", html)).dispatched).toBe(false);
  });

  it("does not put the error text of the failure in the result (no leaking internals)", async () => {
    const boom = (() => Promise.reject(new Error("secret internal detail"))) as unknown as typeof fetch;
    expect(JSON.stringify(await dispatchBeginWork("https://d", ID, "", boom))).not.toContain("secret internal detail");
  });

  it("refuses a non-UUID work item id without calling fetch", async () => {
    for (const bad of ["wi-1", "../admin", `${ID}/../x`, `${ID}?a=b`, ""]) {
      const f = vi.fn();
      const r = await dispatchBeginWork("https://d", bad, "", f as unknown as typeof fetch);
      expect(r).toEqual({ dispatched: false, error: "invalid work item id" });
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("accepts an upper-case UUID", async () => {
    const f = vi.fn(() => ok({ dispatched: true }));
    const r = await dispatchBeginWork("https://d", ID.toUpperCase(), "", f as unknown as typeof fetch);
    expect(r).toEqual({ dispatched: true });
  });

  it("refuses an origin that is not http(s) without calling fetch", async () => {
    for (const bad of ["javascript:alert(1)", "file:///etc", "ftp://x", "not a url", ""]) {
      const f = vi.fn();
      const r = await dispatchBeginWork(bad, ID, "", f as unknown as typeof fetch);
      expect(r.dispatched).toBe(false);
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("turns an abort/timeout into a network error and never throws", async () => {
    const timeout = (() => Promise.reject(new DOMException("The operation timed out", "TimeoutError"))) as unknown as typeof fetch;
    expect(await dispatchBeginWork("https://d", ID, "", timeout)).toEqual({ dispatched: false, error: "network error" });
    const abort = (() => Promise.reject(new DOMException("aborted", "AbortError"))) as unknown as typeof fetch;
    expect(await dispatchBeginWork("https://d", ID, "", abort)).toEqual({ dispatched: false, error: "network error" });
  });

  it("never follows redirects with the cookie, and a redirect rejection is a network error", async () => {
    const f = vi.fn(() => ok({ dispatched: true }));
    await dispatchBeginWork("https://d", ID, "c=1", f as unknown as typeof fetch);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("error");
    const redir = (() => Promise.reject(new TypeError("fetch failed: redirect"))) as unknown as typeof fetch;
    expect(await dispatchBeginWork("https://d", ID, "c=1", redir)).toEqual({ dispatched: false, error: "network error" });
  });
});

describe("dispatchBaseUrl", () => {
  it("uses the configured value with trailing slashes stripped", () => {
    expect(dispatchBaseUrl({ DASHBOARD_BASE_URL: "https://dash.example.com//" })).toBe("https://dash.example.com");
  });
  it("defaults when unset", () => {
    expect(dispatchBaseUrl({})).toBe("https://dashboard.rosably.com");
  });
  it("falls back to the default for a non-http(s) or invalid value", () => {
    expect(dispatchBaseUrl({ DASHBOARD_BASE_URL: "javascript:alert(1)" })).toBe("https://dashboard.rosably.com");
    expect(dispatchBaseUrl({ DASHBOARD_BASE_URL: "nope" })).toBe("https://dashboard.rosably.com");
  });
});
