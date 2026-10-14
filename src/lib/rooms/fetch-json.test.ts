import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson } from "./fetch-json";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns data for ok JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ a: 1 })));
    expect(await fetchJson("/x")).toEqual({ ok: true, data: { a: 1 } });
  });
  it("uses body.error for non-ok JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "nope" }, 400)));
    expect(await fetchJson("/x")).toEqual({ ok: false, error: "nope" });
  });
  it("falls back to HTTP status when non-ok JSON has no error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 500)));
    expect(await fetchJson("/x")).toEqual({ ok: false, error: "Request failed (HTTP 500)" });
  });
  it("reports non-JSON (HTML login redirect) responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } })));
    expect(await fetchJson("/x")).toEqual({ ok: false, error: "Unexpected response (are you signed in?)" });
  });
  it("reports network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    expect(await fetchJson("/x")).toEqual({ ok: false, error: "Network error" });
  });
});
