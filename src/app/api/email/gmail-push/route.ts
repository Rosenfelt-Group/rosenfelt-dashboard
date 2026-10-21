import { NextRequest, NextResponse } from "next/server";
import { verifyPushToken } from "@/lib/email/push-auth";
import { processPush, logWorkflow } from "@/lib/email/gmail-sync";

export const maxDuration = 300; // processPush stops at ~240s (RUN_BUDGET_MS)

// Pub/Sub push endpoint. Excluded from session middleware; authenticated by Google's OIDC JWT.
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !(await verifyPushToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let trigger = "unparsed push";
  try {
    const body = (await request.json()) as { message?: { data?: string } };
    const data = JSON.parse(Buffer.from(body.message?.data ?? "", "base64").toString("utf8")) as { emailAddress?: string; historyId?: string | number };
    const historyId = String(data.historyId ?? "");
    if (!/^\d+$/.test(historyId)) throw new Error("push payload has no valid historyId");
    trigger = `historyId ${historyId}`;
    await processPush(historyId);
  } catch (e) {
    await logWorkflow("gmail-push", "error", e instanceof Error ? e.message : String(e), trigger);
  }
  // Always ack after a verified push so Pub/Sub does not retry forever; the next push resumes.
  return new NextResponse(null, { status: 204 });
}
