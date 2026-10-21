/**
 * One-shot Google OAuth grant (loopback redirect flow) for a single scope.
 *
 *   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
 *     npx tsx scripts/google-oauth-grant.ts --scope gmail.readonly --env GMAIL_READ_REFRESH_TOKEN
 *
 * Opens a listener on http://127.0.0.1:<random port>, prints the consent URL, exchanges the code, and
 * stores the refresh token as a production Vercel env var via the Vercel REST API (the CLI's stdin mode
 * is broken non-interactively). The token is NEVER printed. Debug escape hatch: --print-to-fd 3 writes
 * it to file descriptor 3 instead of Vercel (off by default).
 *
 * Vercel project/team ids come from .vercel/project.json, the API token from
 * ~/.local/share/com.vercel.cli/auth.json.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

const SCOPES: Record<string, string> = {
  "gmail.readonly": "https://www.googleapis.com/auth/gmail.readonly",
  "gmail.send": "https://www.googleapis.com/auth/gmail.send",
};

export function resolveScope(input: string): string {
  if (SCOPES[input]) return SCOPES[input];
  const full = Object.values(SCOPES).find((s) => s === input);
  if (full) return full;
  throw new Error(`Unsupported scope "${input}". Allowed: ${Object.keys(SCOPES).join(", ")} (one at a time)`);
}

export function parseArgs(argv: string[]): { scope: string; env: string; printToFd?: number } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const scope = get("--scope");
  const env = get("--env");
  if (!scope || !env) throw new Error("usage: google-oauth-grant.ts --scope <gmail.readonly|gmail.send> --env <ENV_NAME> [--print-to-fd 3]");
  resolveScope(scope);
  if (!/^[A-Z][A-Z0-9_]*$/.test(env)) throw new Error(`Invalid env var name "${env}"`);
  const fd = get("--print-to-fd");
  return { scope, env, printToFd: fd === undefined ? undefined : Number(fd) };
}

export function buildAuthUrl(o: { clientId: string; port: number; scope: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: `http://127.0.0.1:${o.port}`,
    response_type: "code",
    scope: resolveScope(o.scope),
    access_type: "offline",
    prompt: "consent",
    state: o.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export function buildVercelEnvRequest(o: { projectId: string; teamId: string; token: string; name: string; value: string }) {
  return {
    url: `https://api.vercel.com/v10/projects/${o.projectId}/env?teamId=${o.teamId}&upsert=true`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key: o.name, value: o.value, type: "encrypted", target: ["production"] }),
    } as RequestInit,
  };
}

function startListener(state: string): Promise<{ port: number; code: Promise<string>; close: () => void }> {
  return new Promise((resolveStart) => {
    let resolveCode!: (c: string) => void;
    let rejectCode!: (e: Error) => void;
    const code = new Promise<string>((res, rej) => { resolveCode = res; rejectCode = rej; });
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      if (u.searchParams.get("state") !== state || (!c && !err)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" }).end(err ? `Failed: ${err}` : "Done. You can close this tab.");
      if (err) rejectCode(new Error(`Consent failed: ${err}`));
      else resolveCode(c!);
    });
    server.listen(0, "127.0.0.1", () =>
      resolveStart({ port: (server.address() as AddressInfo).port, code, close: () => server.close() }),
    );
  });
}

async function main() {
  const { scope, env, printToFd } = parseArgs(process.argv.slice(2));
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set");

  const state = randomBytes(16).toString("hex");
  const { port, code: pending, close } = await startListener(state);
  console.log(`Open this URL and approve (${scope}):\n\n${buildAuthUrl({ clientId, port, scope, state })}\n`);

  let code: string;
  try {
    code = await pending;
  } finally {
    close();
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: `http://127.0.0.1:${port}`, grant_type: "authorization_code",
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
  const refresh = ((await tokenRes.json()) as { refresh_token?: string }).refresh_token;
  if (!refresh) throw new Error("No refresh_token returned (revoke the app's prior grant and retry)");

  if (printToFd !== undefined) {
    fs.writeSync(printToFd, refresh + "\n");
    console.log(`Refresh token written to fd ${printToFd}.`);
    return;
  }

  const proj = JSON.parse(fs.readFileSync(path.resolve(".vercel/project.json"), "utf8")) as { projectId: string; orgId: string };
  const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".local/share/com.vercel.cli/auth.json"), "utf8")) as { token: string };
  const req = buildVercelEnvRequest({ projectId: proj.projectId, teamId: proj.orgId, token: auth.token, name: env, value: refresh });
  const res = await fetch(req.url, req.init);
  if (!res.ok) throw new Error(`Vercel env upsert failed (${res.status})`);
  console.log(`Stored ${env} in Vercel production. Redeploy for it to take effect.`);
}

if (/google-oauth-grant\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
