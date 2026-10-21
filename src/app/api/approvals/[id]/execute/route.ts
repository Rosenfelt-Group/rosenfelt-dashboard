import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { executeApproval } from "@/lib/email/executor";

export const maxDuration = 60;

// Executes an approved email_send row. Idempotent: a row that is not (or no longer) approved is skipped.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, "manage_approvals");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const r = await executeApproval(id);
    return NextResponse.json(r, { status: r.status === "skipped" ? 409 : 200 });
  } catch (e) {
    console.error("execute approval failed:", e);
    return NextResponse.json({ status: "failed", error: e instanceof Error ? e.message : "Execute failed" }, { status: 500 });
  }
}
