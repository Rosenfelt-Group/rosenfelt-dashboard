import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export const maxDuration = 30;

const BUCKET = "audit-reports";
const PREFIX = "stack-audits";

type StorageListItem = {
  name: string;
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
  last_accessed_at: string | null;
  metadata: { size?: number; mimetype?: string } | null;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  // Cookie auth — the PDF is a client deliverable, not public
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id: workItemId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(workItemId)) {
    return NextResponse.json({ error: "Invalid work item id" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Server config missing" }, { status: 500 });
  }

  // List objects under stack-audits/<work_item_id>/ — most recent first
  const listRes = await fetch(
    `${supabaseUrl}/storage/v1/object/list/${BUCKET}`,
    {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix: `${PREFIX}/${workItemId}/`,
        limit: 10,
        sortBy: { column: "created_at", order: "desc" },
      }),
    },
  );

  if (!listRes.ok) {
    const detail = await listRes.text().catch(() => "");
    return NextResponse.json(
      { error: "Storage list failed", detail, status: listRes.status },
      { status: 502 },
    );
  }

  const items = (await listRes.json()) as StorageListItem[];
  const latest = items.find(i => i.name.endsWith(".pdf"));
  if (!latest) {
    return NextResponse.json(
      { error: "No deliverable found for this work item" },
      { status: 404 },
    );
  }

  const objectPath = `${PREFIX}/${workItemId}/${latest.name}`;
  const objRes = await fetch(
    `${supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath}`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    },
  );

  if (!objRes.ok) {
    const detail = await objRes.text().catch(() => "");
    return NextResponse.json(
      { error: "Storage fetch failed", detail, status: objRes.status },
      { status: 502 },
    );
  }

  const download = req.nextUrl.searchParams.get("download") === "true";
  const disposition = download ? "attachment" : "inline";

  return new NextResponse(objRes.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${latest.name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
