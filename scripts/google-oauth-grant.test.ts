import { describe, it, expect } from "vitest";
import { buildAuthUrl, resolveScope, parseArgs, buildVercelEnvRequest } from "./google-oauth-grant";

describe("google-oauth-grant", () => {
  it("resolves short scope names and rejects unknown scopes", () => {
    expect(resolveScope("gmail.readonly")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(resolveScope("gmail.send")).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(resolveScope("https://www.googleapis.com/auth/gmail.send")).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(() => resolveScope("gmail.modify")).toThrow();
    expect(() => resolveScope("gmail.send gmail.readonly")).toThrow();
  });

  it("builds an offline, consent, single-scope loopback URL", () => {
    const u = new URL(buildAuthUrl({ clientId: "cid", port: 5123, scope: "gmail.send", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5123");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("parses args", () => {
    expect(parseArgs(["--scope", "gmail.send", "--env", "GMAIL_SEND_REFRESH_TOKEN"])).toEqual({ scope: "gmail.send", env: "GMAIL_SEND_REFRESH_TOKEN", printToFd: undefined });
    expect(parseArgs(["--scope", "gmail.send", "--env", "X", "--print-to-fd", "3"]).printToFd).toBe(3);
    expect(() => parseArgs(["--scope", "gmail.send"])).toThrow();
    expect(() => parseArgs(["--scope", "gmail.send", "--env", "bad name"])).toThrow();
  });

  it("builds the Vercel upsert request without leaking the token into the URL", () => {
    const r = buildVercelEnvRequest({ projectId: "prj_1", teamId: "team_1", token: "vt", name: "GMAIL_SEND_REFRESH_TOKEN", value: "secret-rt" });
    expect(r.url).toBe("https://api.vercel.com/v10/projects/prj_1/env?teamId=team_1&upsert=true");
    expect(r.init.method).toBe("POST");
    expect((r.init.headers as Record<string, string>).Authorization).toBe("Bearer vt");
    expect(JSON.parse(String(r.init.body))).toEqual({ key: "GMAIL_SEND_REFRESH_TOKEN", value: "secret-rt", type: "encrypted", target: ["production"] });
    expect(r.url).not.toContain("secret-rt");
  });
});
