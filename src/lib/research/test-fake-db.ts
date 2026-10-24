// In-memory stand-in for the slice of the supabase-js query builder the research code uses
// (select/eq/in/is/order/limit, maybeSingle/single, insert/upsert/delete). Test-only.
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  errors: Record<string, { message: string }> = {};
  ops: { table: string; op: string; payload?: unknown }[] = [];

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    const db = this;
    const filters: Filter[] = [];
    let op: "select" | "delete" | "insert" | "upsert" = "select";
    let payload: Row[] = [];
    let conflict: string[] = [];
    let single: "one" | "maybe" | null = null;

    const run = () => {
      const err = db.errors[table];
      if (err) return { data: null, error: err };
      const all = db.rows(table);
      const match = (r: Row) => filters.every(f => f(r));
      if (op === "delete") {
        db.ops.push({ table, op });
        db.tables[table] = all.filter(r => !match(r));
        return { data: null, error: null };
      }
      if (op === "insert" || op === "upsert") {
        db.ops.push({ table, op, payload });
        const out: Row[] = [];
        for (const p of payload) {
          const dup = conflict.length && all.find(r => conflict.every(c => r[c] === p[c]));
          if (dup) continue;
          const row = { id: p.id ?? `id-${all.length + 1}`, created_at: "2026-10-25T00:00:00Z", ...p };
          all.push(row);
          out.push(row);
        }
        return { data: single ? out[0] ?? null : out, error: null };
      }
      const found = all.filter(match);
      if (single) return { data: found[0] ?? null, error: null };
      return { data: found, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return b; },
      in: (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return b; },
      is: (c: string, v: unknown) => { filters.push(r => (r[c] ?? null) === v); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: () => { single = "maybe"; return Promise.resolve(run()); },
      single: () => { single = "one"; return Promise.resolve(run()); },
      insert: (p: Row | Row[]) => { op = "insert"; payload = Array.isArray(p) ? p : [p]; return b; },
      upsert: (p: Row | Row[], o?: { onConflict?: string }) => {
        op = "upsert"; payload = Array.isArray(p) ? p : [p]; conflict = (o?.onConflict ?? "").split(",").filter(Boolean);
        return b;
      },
      delete: () => { op = "delete"; return b; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }

  client() {
    return { from: (t: string) => this.from(t), schema: () => ({ from: (t: string) => this.from(t) }) };
  }
}
