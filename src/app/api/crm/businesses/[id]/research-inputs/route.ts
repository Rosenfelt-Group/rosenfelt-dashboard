import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/requirePermission";
import { getLiveBusiness, loadOrgResearch, ResearchError, setResearchInputs } from "@/lib/research/org-research";

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  items: z.array(z.object({
    type: z.enum(["note", "brief"]),
    id: z.string().uuid("id must be a uuid"),
    selected: z.boolean(),
  })).min(1, "items is required").max(200),
});

/** Tick or untick research for the scope ("Use in scope"). Returns the organization's research afterwards. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid items" }, { status: 400 });

  try {
    if (!(await getLiveBusiness(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await setResearchInputs(id, parsed.data.items, guard.username);
    return NextResponse.json(await loadOrgResearch(id));
  } catch (e) {
    if (e instanceof ResearchError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
