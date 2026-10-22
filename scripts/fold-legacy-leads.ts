/**
 * Fold legacy public.prospects + public.assessment_leads rows into crm via intakeLead().
 *
 *   npx vite-node --config vitest.config.ts scripts/fold-legacy-leads.ts            # --dry-run (default)
 *   npx vite-node --config vitest.config.ts scripts/fold-legacy-leads.ts --apply --confirm
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment (falls back to .env.local).
 * --apply requires --confirm. Dry-run only SELECTs.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  classifyAssessmentLead, classifyProspect, formatDecision,
  type FoldDecision, type LegacyAssessmentLead, type LegacyProspect,
} from "../src/lib/intake/fold-legacy";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const confirm = args.includes("--confirm");
  if (apply && !confirm) {
    console.error("Refusing to run: --apply requires --confirm as well.");
    process.exit(2);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [pr, ar] = await Promise.all([
    db.from("prospects").select("id, org_name, source, notes, discovery_call_booked_at").order("created_at"),
    db.from("assessment_leads").select("id, name, email, org, source, org_type, created_at").order("created_at"),
  ]);
  if (pr.error) throw pr.error;
  if (ar.error) throw ar.error;

  const decisions: FoldDecision[] = [
    ...(pr.data as LegacyProspect[]).map(classifyProspect),
    ...(ar.data as LegacyAssessmentLead[]).map(classifyAssessmentLead),
  ];
  console.log(apply ? "MODE: apply" : "MODE: dry-run");
  for (const d of decisions) console.log(formatDecision(d));
  const todo = decisions.filter((d): d is Extract<FoldDecision, { action: "intake" }> => d.action === "intake");
  console.log(`\n${todo.length} to intake, ${decisions.length - todo.length} skipped, ${decisions.length} total`);
  if (!apply) return;

  const { intakeLead } = await import("../src/lib/intake/client");
  // Safe to re-run: intakeLead dedupes by email (matches the existing contact/lead), so repeating --apply
  // after a partial failure does not create duplicates.
  let ok = 0;
  for (const d of todo) {
    try {
      const r = await intakeLead(d.input);
      ok++;
      console.log(`ok ${d.table}/${d.id} -> lead ${r.lead_id}${r.created_lead ? " (new)" : " (matched)"}`);
    } catch (e) {
      console.error(`FAIL ${d.table}/${d.id}: ${(e as Error).message}`);
    }
  }
  console.log(`applied ${ok}/${todo.length}`);
  if (ok < todo.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
