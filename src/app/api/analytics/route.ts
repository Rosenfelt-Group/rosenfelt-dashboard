import { NextRequest, NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OverviewRow = { date: string; sessions: number; users: number; pageviews: number };
type SourceRow   = { channel: string; sessions: number };
type PageRow     = { path: string; title: string; pageviews: number; avgSessionDurationSec: number };
type EventRow    = { eventName: string; count: number };

// Internal GA events to hide from the "Top Events" table (these dominate the chart and aren't
// useful conversion signals).
const INTERNAL_EVENTS = new Set([
  "session_start",
  "first_visit",
  "user_engagement",
  "scroll",
  "click",
  "page_view",
]);

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultDateRange() {
  const end   = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 29); // last 30 days inclusive
  return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

function buildClient() {
  const raw = process.env.GA_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GA_SERVICE_ACCOUNT_KEY is not set");

  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error("GA_SERVICE_ACCOUNT_KEY is not valid JSON");
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GA_SERVICE_ACCOUNT_KEY is missing client_email or private_key");
  }
  // Vercel env vars escape newlines inside the private_key. Normalize.
  credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  return new BetaAnalyticsDataClient({ credentials });
}

// GA4 returns date as "YYYYMMDD" — reformat to "YYYY-MM-DD" for client charts.
function fmtDate(d: string): string {
  if (d.length !== 8) return d;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export async function GET(req: NextRequest) {
  const url       = new URL(req.url);
  const params    = url.searchParams;
  const defaults  = defaultDateRange();
  const startDate = params.get("startDate") || defaults.startDate;
  const endDate   = params.get("endDate")   || defaults.endDate;

  if (!process.env.GA_SERVICE_ACCOUNT_KEY || !process.env.GA_PROPERTY_ID) {
    return NextResponse.json(
      { error: "Analytics not configured. Add GA_SERVICE_ACCOUNT_KEY and GA_PROPERTY_ID to Vercel environment variables." },
      { status: 503 },
    );
  }

  let client: BetaAnalyticsDataClient;
  try {
    client = buildClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to initialize GA client";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const property  = `properties/${process.env.GA_PROPERTY_ID}`;
  const dateRange = { startDate, endDate };

  try {
    const [overviewRes, sourcesRes, pagesRes, eventsRes] = await Promise.all([
      client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
      }),
      client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 8,
      }),
      client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
        ],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      }),
      // Pull a larger event window so we still have 10 after filtering internal events.
      client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 30,
      }),
    ]);

    const overview: OverviewRow[] = (overviewRes[0].rows ?? []).map(row => ({
      date:      fmtDate(row.dimensionValues?.[0]?.value ?? ""),
      sessions:  Number(row.metricValues?.[0]?.value ?? 0),
      users:     Number(row.metricValues?.[1]?.value ?? 0),
      pageviews: Number(row.metricValues?.[2]?.value ?? 0),
    }));

    const sources: SourceRow[] = (sourcesRes[0].rows ?? []).map(row => ({
      channel:  row.dimensionValues?.[0]?.value || "(unknown)",
      sessions: Number(row.metricValues?.[0]?.value ?? 0),
    }));

    const pages: PageRow[] = (pagesRes[0].rows ?? []).map(row => ({
      path:                  row.dimensionValues?.[0]?.value || "",
      title:                 row.dimensionValues?.[1]?.value || "",
      pageviews:             Number(row.metricValues?.[0]?.value ?? 0),
      avgSessionDurationSec: Number(row.metricValues?.[1]?.value ?? 0),
    }));

    const events: EventRow[] = (eventsRes[0].rows ?? [])
      .map(row => ({
        eventName: row.dimensionValues?.[0]?.value || "",
        count:     Number(row.metricValues?.[0]?.value ?? 0),
      }))
      .filter(e => !INTERNAL_EVENTS.has(e.eventName))
      .slice(0, 10);

    return NextResponse.json({
      overview,
      sources,
      pages,
      events,
      dateRange: { startDate, endDate },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "GA4 request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
