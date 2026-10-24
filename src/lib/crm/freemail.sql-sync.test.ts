import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FREE_MAIL_DOMAINS } from "./suggest";

describe("crm.intake_lead free-mail list", () => {
  it("v_freemail in the live intake_lead definition matches FREE_MAIL_DOMAINS", () => {
    const file = path.resolve(__dirname, "../../../docs/migrations/2026-10-24_intake_existing_client.sql");
    const sql = readFileSync(file, "utf8");
    const m = sql.match(/v_freemail\s+constant\s+text\[\]\s*:=\s*array\[([^\]]+)\]/i);
    expect(m, "v_freemail array literal not found in migration").not.toBeNull();
    const sqlDomains = [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    expect(sqlDomains).toEqual([...FREE_MAIL_DOMAINS]);
  });
});
