import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const approvalId = req.nextUrl.searchParams.get("approval_id");
  if (!approvalId) {
    return NextResponse.json({ error: "approval_id required" }, { status: 400 });
  }

  const { data: approval, error } = await supabaseAdmin
    .from("pending_approvals")
    .select("agent, action_type, payload")
    .eq("id", approvalId)
    .single();

  if (error || !approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }
  if (approval.action_type !== "stack_audit_report") {
    return NextResponse.json({ error: "Not a stack_audit_report approval" }, { status: 400 });
  }

  const pdfPath = (approval.payload as { pdf_path?: string } | null)?.pdf_path;
  if (typeof pdfPath !== "string" || !pdfPath.startsWith("/tmp/")) {
    return NextResponse.json({ error: "Invalid pdf_path on approval" }, { status: 400 });
  }
  const filename = pdfPath.replace(/^\/tmp\//, "");
  if (!/^stack_audit_[a-f0-9]{8}\.pdf$/.test(filename)) {
    return NextResponse.json({ error: "Invalid pdf filename" }, { status: 400 });
  }

  const avUrl = process.env.AVERY_AGENT_URL;
  const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;
  if (!avUrl || !secret) {
    return NextResponse.json({ error: "Server config missing" }, { status: 500 });
  }

  const res = await fetch(`${avUrl}/audit-pdf/${filename}`, {
    headers: { "X-Webhook-Secret": secret },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Avery returned HTTP ${res.status}`, detail },
      { status: 502 },
    );
  }

  // Stream the PDF straight back to the browser
  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
