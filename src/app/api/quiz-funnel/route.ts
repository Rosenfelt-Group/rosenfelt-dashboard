import { NextRequest, NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FUNNEL_STEPS = [
  "quiz_start",
  "quiz_gate",
  "generate_snapshot",
  "snapshot_generated",
  "checkout_click",
] as const;

function buildClient() {
  const raw = process.env.GA_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GA_SERVICE_ACCOUNT_KEY not set");
  const creds = JSON.parse(raw);
  creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  return new BetaAnalyticsDataClient({ credentials: creds });
}

export async function GET(req: NextRequest) {
  const token   = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const client   = buildClient();
    const property = `properties/${process.env.GA_PROPERTY_ID}`;

    const end   = new Date();
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 29);
    const dateRange = {
      startDate: start.toISOString().slice(0, 10),
      endDate:   end.toISOString().slice(0, 10),
    };

    const [res] = await client.runReport({
      property,
      dateRanges: [dateRange],
      dimensions: [{ name: "eventName" }],
      metrics:    [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: [...FUNNEL_STEPS] },
        },
      },
    });

    const countByEvent: Record<string, number> = {};
    for (const row of res.rows ?? []) {
      const name  = row.dimensionValues?.[0]?.value ?? "";
      const count = Number(row.metricValues?.[0]?.value ?? 0);
      countByEvent[name] = count;
    }

    const steps = FUNNEL_STEPS.map((name, i) => {
      const count   = countByEvent[name] ?? 0;
      const prevIdx = i > 0 ? i - 1 : null;
      const prev    = prevIdx !== null ? (countByEvent[FUNNEL_STEPS[prevIdx]] ?? 0) : null;
      const dropoff = prev !== null && prev > 0 ? Math.round((1 - count / prev) * 100) : null;
      return { name, count, dropoff };
    });

    return NextResponse.json({ steps, dateRange });
  } catch (e) {
    const message = e instanceof Error ? e.message : "GA4 request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
