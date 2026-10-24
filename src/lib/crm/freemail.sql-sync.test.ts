import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FREE_MAIL_DOMAINS } from "./suggest";

const dir = path.resolve(__dirname, "../../../docs/migrations");
const domains = (list: string) => [...list.matchAll(/'([^']+)'/g)].map(x => x[1]);

describe("SQL free-mail list", () => {
  it("v_freemail in the 2026-10-24 intake_lead definition matches FREE_MAIL_DOMAINS", () => {
    const sql = readFileSync(path.join(dir, "2026-10-24_intake_existing_client.sql"), "utf8");
    const m = sql.match(/v_freemail\s+constant\s+text\[\]\s*:=\s*array\[([^\]]+)\]/i);
    expect(m, "v_freemail array literal not found in migration").not.toBeNull();
    expect(domains(m![1])).toEqual([...FREE_MAIL_DOMAINS]);
  });

  it("crm.freemail_domains() (used by the live intake_lead and duplicate detection) matches FREE_MAIL_DOMAINS", () => {
    const sql = readFileSync(path.join(dir, "2026-10-25_b_crm_merge_dedupe.sql"), "utf8");
    const m = sql.match(/function crm\.freemail_domains\(\)[\s\S]*?select array\[([^\]]+)\]/i);
    expect(m, "crm.freemail_domains array literal not found").not.toBeNull();
    expect(domains(m![1])).toEqual([...FREE_MAIL_DOMAINS]);
    expect(sql).toMatch(/v_freemail\s+constant\s+text\[\]\s*:=\s*crm\.freemail_domains\(\)/);
  });
});
