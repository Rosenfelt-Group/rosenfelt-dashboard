import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/requirePermission";
import { getLiveBusiness, ResearchError, runOrgResearch } from "@/lib/research/org-research";

// With business_id the run is organization research and waits for Avery (~10-30 s).
export const maxDuration = 60;

const BusinessId = z.string().uuid("business_id must be a uuid");

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topicIn = (body.topic as string | undefined)?.trim();

  // Organization research: lands on the business (crm.business_research + its Research tab).
  if (body.business_id !== undefined && body.business_id !== null && body.business_id !== "") {
    const guard = await requirePermission(req, "manage_crm");
    if (!guard.ok) return guard.response;
    const bid = BusinessId.safeParse(body.business_id);
    if (!bid.success) return NextResponse.json({ error: bid.error.issues[0]?.message }, { status: 400 });
    try {
      const business = await getLiveBusiness(bid.data);
      if (!business) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
      const research = await runOrgResearch(business.id, topicIn || business.name);
      return NextResponse.json({ ok: true, business_id: business.id, research });
    } catch (e) {
      if (e instanceof ResearchError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  }

  const topic = topicIn;
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const AVERY_URL = process.env.AVERY_AGENT_URL;
  if (!AVERY_URL) {
    return NextResponse.json({ error: "AVERY_AGENT_URL not configured" }, { status: 503 });
  }

  const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;

  // Fire and forget — don't await
  fetch(`${AVERY_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": secret ?? "",
    },
    body: JSON.stringify({
      text: `Run research brief on: ${topic}`,
      chatId: "dashboard_research_brian",
    }),
  }).catch(err => console.error("research trigger error:", err));

  return NextResponse.json({ ok: true });
}
