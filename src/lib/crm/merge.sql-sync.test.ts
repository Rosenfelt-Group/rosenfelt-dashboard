import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MERGE_FIELDS, MERGE_KINDS } from "./merge";

describe("crm.merge_fields", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../docs/migrations/2026-10-25_b_crm_merge_dedupe.sql"), "utf8");
  const body = sql.match(/function crm\.merge_fields\(p_kind text\)[\s\S]*?\$\$;/)?.[0] ?? "";

  it.each(MERGE_KINDS)("SQL field list for %s matches MERGE_FIELDS", (kind) => {
    const m = body.match(new RegExp(`when '${kind}'\\s+then array\\[([^\\]]+)\\]`));
    expect(m, `merge_fields branch for ${kind} not found`).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map(x => x[1])).toEqual([...MERGE_FIELDS[kind]]);
  });
});
