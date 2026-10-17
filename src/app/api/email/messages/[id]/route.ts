import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { getMessage } from "@/lib/email/postmark-api";
import { EmailError } from "@/lib/email/gmail";

// GET — one Postmark message's details. Bodies are deliberately stripped: they never go to the browser.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, "view_overview");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { textBody, htmlBody, ...detail } = await getMessage(id);
    return NextResponse.json(detail);
  } catch (e) {
    if (e instanceof EmailError && e.status === 404) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    const code = e instanceof EmailError ? e.code : "send_failed";
    return NextResponse.json({ error: "Could not reach Postmark", code }, { status: 502 });
  }
}
