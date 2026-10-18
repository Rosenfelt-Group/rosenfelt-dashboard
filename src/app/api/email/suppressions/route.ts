import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { EmailError, isValidEmail } from "@/lib/email";
import { listSuppressions, suppress, unsuppress } from "@/lib/email/postmark-api";
import { resolveEvents, logAction } from "@/lib/email/events";

// Postmark failure -> HTTP status + plain-English message for the UI.
function postmarkFailure(e: unknown): NextResponse {
  if (e instanceof EmailError && e.code === "not_configured") {
    return NextResponse.json({ error: "Postmark isn't set up on the server." }, { status: 503 });
  }
  if (e instanceof EmailError && e.code === "auth_failed") {
    return NextResponse.json({ error: "Postmark rejected our login. The server token may be wrong or revoked." }, { status: 502 });
  }
  console.error("email suppressions: postmark failed:", e);
  return NextResponse.json({ error: "Couldn't reach Postmark. Please try again in a moment." }, { status: 502 });
}

async function readEmail(req: NextRequest): Promise<string | null> {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  return isValidEmail(email) ? email : null;
}

// GET — current Postmark block list; canUnblock is false for spam complaints (permanent).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_overview");
  if (!guard.ok) return guard.response;
  try {
    const list = await listSuppressions();
    return NextResponse.json(list.map((s) => ({ ...s, canUnblock: s.reason !== "SpamComplaint" })));
  } catch (e) {
    return postmarkFailure(e);
  }
}

// POST {email} — block an address.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_email");
  if (!guard.ok) return guard.response;
  const email = await readEmail(req);
  if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  try {
    await suppress(email);
  } catch (e) {
    return postmarkFailure(e);
  }
  await logAction({ action: "block", recipient: email, by: guard.username });
  return NextResponse.json({ ok: true });
}

// DELETE {email} — unblock, unless Postmark says the person marked us as spam.
export async function DELETE(req: NextRequest) {
  const guard = await requirePermission(req, "manage_email");
  if (!guard.ok) return guard.response;
  const email = await readEmail(req);
  if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  try {
    const current = (await listSuppressions()).find((s) => s.email.toLowerCase() === email.toLowerCase());
    if (!current) return NextResponse.json({ error: "That address isn't blocked." }, { status: 404 });
    if (current.reason === "SpamComplaint") {
      return NextResponse.json({ error: "Blocked permanently — this person marked us as spam." }, { status: 409 });
    }
    await unsuppress(email);
  } catch (e) {
    return postmarkFailure(e);
  }
  let resolved = 0;
  try {
    resolved = await resolveEvents({ recipient: email }, "unblocked", guard.username);
  } catch (e) {
    console.error("email suppressions: resolve after unblock failed:", e);
  }
  await logAction({ action: "unblock", recipient: email, detail: { resolved }, by: guard.username });
  return NextResponse.json({ ok: true, resolved });
}
