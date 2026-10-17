import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { searchMessages } from "@/lib/email/postmark-api";
import { EmailError } from "@/lib/email/gmail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET ?recipient= — recent Postmark messages sent to one address.
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "view_overview");
  if (!auth.ok) return auth.response;

  const recipient = (req.nextUrl.searchParams.get("recipient") ?? "").trim();
  if (!EMAIL_RE.test(recipient)) {
    return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await searchMessages(recipient));
  } catch (e) {
    const code = e instanceof EmailError ? e.code : "send_failed";
    return NextResponse.json({ error: "Could not reach Postmark", code }, { status: 502 });
  }
}
