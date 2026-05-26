import { NextResponse } from "next/server";
import { AGENT_URLS, AGENT_SECRETS } from "@/lib/agent-urls";

export const maxDuration = 30;

// The dashboard proxies WP status through Avery — Wordfence on rosably.com
// strips Authorization headers from Vercel-originated requests, so direct
// WP REST calls from this route always 401. Avery runs on the VPS where
// Wordfence treats the request as internal and lets auth pass through.

export async function GET() {
  const base = AGENT_URLS.avery?.replace(/\/$/, "");
  const secret = AGENT_SECRETS.avery;

  if (!base) {
    return NextResponse.json(
      {
        configured: false,
        wp_url: null,
        fetched_at: new Date().toISOString(),
        posts: { pending: [], draft: [], future: [] },
        core: { current_version: null, latest_version: null, update_available: false },
        themes: { active: null, all: [] },
        plugins: [],
        errors: ["AVERY_AGENT_URL not configured on Vercel"],
      },
      { status: 200 }
    );
  }

  try {
    const res = await fetch(`${base}/wp/status`, {
      headers: {
        Accept: "application/json",
        ...(secret ? { "X-Webhook-Secret": secret } : {}),
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        {
          configured: false,
          wp_url: null,
          fetched_at: new Date().toISOString(),
          posts: { pending: [], draft: [], future: [] },
          core: { current_version: null, latest_version: null, update_available: false },
          themes: { active: null, all: [] },
          plugins: [],
          errors: [`Avery /wp/status: HTTP ${res.status} ${body.slice(0, 120)}`],
        },
        { status: 200 }
      );
    }

    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json(
      {
        configured: false,
        wp_url: null,
        fetched_at: new Date().toISOString(),
        posts: { pending: [], draft: [], future: [] },
        core: { current_version: null, latest_version: null, update_available: false },
        themes: { active: null, all: [] },
        plugins: [],
        errors: [`Proxy to Avery failed: ${e instanceof Error ? e.message : String(e)}`],
      },
      { status: 200 }
    );
  }
}
