import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.LITELLM_BASE_URL;
const KEY  = process.env.LITELLM_MASTER_KEY;

function isoDate(d: Date) {
  return d.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  if (!BASE || !KEY) {
    return NextResponse.json({ error: "LiteLLM not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const days  = Math.min(parseInt(searchParams.get("days") ?? "30"), 90);
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startStr = isoDate(start);
  const endStr   = isoDate(new Date());
  const headers  = { Authorization: `Bearer ${KEY}` };

  try {
    const [logsRes, tagsRes, dailyRes] = await Promise.all([
      fetch(`${BASE}/spend/logs?start_date=${startStr}&end_date=${endStr}`, { headers }),
      fetch(`${BASE}/global/spend/tags?start_date=${startStr}&end_date=${endStr}`, { headers }),
      fetch(`${BASE}/global/spend/report?start_date=${startStr}&end_date=${endStr}`, { headers }),
    ]);

    const [logs, tags, daily] = await Promise.all([
      logsRes.ok  ? logsRes.json()  : [],
      tagsRes.ok  ? tagsRes.json()  : [],
      dailyRes.ok ? dailyRes.json() : [],
    ]);

    return NextResponse.json({
      logs:  Array.isArray(logs)  ? logs  : [],
      tags:  Array.isArray(tags)  ? tags  : [],
      daily: Array.isArray(daily) ? daily : [],
    });
  } catch (err) {
    console.error("LiteLLM fetch error:", err);
    return NextResponse.json({ error: "Failed to reach LiteLLM" }, { status: 502 });
  }
}
