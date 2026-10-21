import { supabaseAdmin } from "@/lib/supabase-admin";
import type { IntakeInput, IntakeResult } from "./schema";

export class IntakeError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "IntakeError";
  }
}

/** In-process entry point for dashboard routes: create or match a lead via crm.intake_lead. */
export async function intakeLead(input: IntakeInput): Promise<IntakeResult> {
  const { data, error } = await supabaseAdmin.schema("crm").rpc("intake_lead", { p: input });
  if (error) throw new IntakeError(error.message, error.code);
  if (!data) throw new IntakeError("intake_lead returned no data");
  return data as IntakeResult;
}
