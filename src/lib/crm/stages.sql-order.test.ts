import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STAGES } from "./stages";

describe("crm.intake_lead stage order", () => {
  // Every migration that defines crm.intake_lead; the last one is the live definition.
  it.each([
    "2026-10-22_crm_identity_intake.sql",
    "2026-10-24_intake_existing_client.sql",
    "2026-10-25_b_crm_merge_dedupe.sql",
  ])("hardcoded SQL stage array in %s matches STAGES order", (name) => {
    const file = path.resolve(__dirname, "../../../docs/migrations", name);
    const sql = readFileSync(file, "utf8");
    const m = sql.match(/v_stages\s+constant\s+text\[\]\s*:=\s*array\[([^\]]+)\]/i);
    expect(m, "v_stages array literal not found in migration").not.toBeNull();
    const sqlStages = [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    expect(sqlStages).toEqual(STAGES.map(s => s.stage));
  });
});
