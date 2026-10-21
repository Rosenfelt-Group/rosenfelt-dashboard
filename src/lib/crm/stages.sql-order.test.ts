import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STAGES } from "./stages";

describe("crm.intake_lead stage order", () => {
  it("hardcoded SQL stage array matches STAGES order", () => {
    const file = path.resolve(__dirname, "../../../docs/migrations/2026-10-22_crm_identity_intake.sql");
    const sql = readFileSync(file, "utf8");
    const m = sql.match(/v_stages\s+constant\s+text\[\]\s*:=\s*array\[([^\]]+)\]/i);
    expect(m, "v_stages array literal not found in migration").not.toBeNull();
    const sqlStages = [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    expect(sqlStages).toEqual(STAGES.map(s => s.stage));
  });
});
