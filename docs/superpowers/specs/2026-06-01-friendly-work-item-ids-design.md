# Friendly Work-Item IDs — Design Spec

**Date:** 2026-06-01
**Repo:** `Rosenfelt-Group/dashboard` (`/opt/rosenfelt/rosenfelt-dashboard`)
**Status:** Approved — ready for implementation plan

## Problem

`work_items.id` is a 32-char UUID and it is the value shown in the `/work/<id>`
URL and referenced everywhere internally. UUIDs are unreadable and unmemorable.
Brian wants a short, human-friendly identifier so a work item reads as `#1009`
and its URL is `/work/1009`.

## Goal

Add a short, sequential, human-facing integer identifier (`ref`) to each work
item, surfaced in the dashboard UI and URL — **without** changing the UUID
primary key or any internal reference to it (agent tools, n8n workflows,
`work_item_logs`, `doc_registry`, `audit_log`, etc. all keep using the UUID).

## Non-Goals (v1)

- No friendly-ID plumbing into agent Telegram messages, agent logs, or n8n
  workflows. Agents and n8n continue to reference work items by UUID.
- No change to the UUID primary key or to any foreign key that targets it.
- No per-type prefixing (decided against `INFRA-12`-style schemes).

## Decisions (from brainstorming)

- **Scheme:** one global integer sequence, **starting at 1000**.
- **Display:** `#1009`. **URL:** `/work/1009`.
- **Backfill:** existing rows numbered by `created_at` ascending, starting at 1000.
- **Backward compatibility:** the detail route resolves *either* a numeric `ref`
  *or* a UUID, so all existing UUID-based links keep working.

## Architecture

### 1. Database migration

A single idempotent migration file at
`/opt/rosenfelt/docs/migrations/2026-06-01-work-items-ref.sql`, applied via the
Supabase Management API (`mcp__claude_ai_Supabase__apply_migration`).

Steps, in order:

1. `ALTER TABLE work_items ADD COLUMN IF NOT EXISTS ref bigint;`
2. Backfill (only rows where `ref IS NULL`):
   ```sql
   WITH ordered AS (
     SELECT id, (row_number() OVER (ORDER BY created_at, id) + 999) AS rn
     FROM work_items
     WHERE ref IS NULL
   )
   UPDATE work_items w SET ref = o.rn FROM ordered o WHERE w.id = o.id;
   ```
3. Sequence for new inserts, continuing after the current max:
   ```sql
   CREATE SEQUENCE IF NOT EXISTS work_items_ref_seq;
   SELECT setval('work_items_ref_seq', (SELECT COALESCE(MAX(ref), 999) FROM work_items));
   ALTER TABLE work_items ALTER COLUMN ref SET DEFAULT nextval('work_items_ref_seq');
   ```
4. Enforce integrity:
   ```sql
   ALTER TABLE work_items ALTER COLUMN ref SET NOT NULL;
   -- guarded so re-running doesn't error on an existing constraint
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_ref_key') THEN
       ALTER TABLE work_items ADD CONSTRAINT work_items_ref_key UNIQUE (ref);
     END IF;
   END $$;
   ```

Because step 3 sets a column DEFAULT, **new inserts auto-number** — n8n
workflows and agent tools that `INSERT` without a `ref` are unaffected.

### 2. Route resolution helper

A small shared helper resolves an inbound `[id]` param to the right column:

```ts
// numeric → friendly ref; anything else (UUIDs have hyphens/letters) → uuid id
export function workItemIdFilter(id: string): { column: "ref" | "id"; value: number | string } {
  return /^\d+$/.test(id)
    ? { column: "ref", value: Number(id) }
    : { column: "id", value: id };
}
```

Applied in:
- `src/app/(dashboard)/work/[id]/page.tsx` (server loader `.eq(column, value)`)
- `src/app/api/work/[id]/route.ts` — **GET** and **PATCH**

The `[id]/*` sub-routes (`dispatch`, `logs`, `status-check`, `write-prompt`,
`resend-audit`, `deliverable.pdf`, `docs`) stay UUID-only: `WorkItemDetail`
receives the fully-resolved item (with its UUID) as `initial` and uses
`initial.id` for every sub-resource call, regardless of how the page URL was
reached. (Implementation plan must verify this assumption against
`WorkItemDetail.tsx` and, if any sub-call uses the URL param instead of
`initial.id`, either switch it to `initial.id` or extend the helper to that
route.)

### 3. Type + display

- Add `ref: number;` to the `WorkItem` interface in `src/types/index.ts`
  (non-optional — the column is `NOT NULL` after migration).
- Show `#${item.ref}`:
  - `src/components/work/KanbanCard.tsx` (card face)
  - `src/app/(dashboard)/work/[id]/WorkItemDetail.tsx` (header)
  - Advanced Search result rows (when that feature lands)
- Navigation now targets the friendly URL:
  - `KanbanCard.tsx:67` → `router.push(`/work/${item.ref}`)`
  - `work/page.tsx:985` (search/flat-list row) → `/work/${item.ref}`
  - Documents (`documents/page.tsx:134`) and CRM (`crm/clients/[id]/page.tsx:431`)
    links reference a stored `work_item_id` (UUID) and **keep using the UUID** —
    they resolve fine via the dual-resolution route. No change required.

## Data Flow

1. User clicks a card → `router.push("/work/1009")`.
2. `work/[id]/page.tsx` loader calls `workItemIdFilter("1009")` →
   `.eq("ref", 1009).single()` → renders `WorkItemDetail` with the full row
   (including UUID `id`).
3. `WorkItemDetail` uses `initial.id` (UUID) for all logs/dispatch/PATCH calls.
4. A PATCH to `/api/work/1009` likewise resolves `ref → row`, updates by the
   row, returns it.
5. A legacy link `/work/<uuid>` still resolves via the `id` branch — unchanged.

## Error Handling / Edge Cases

- **Not found:** numeric ref or UUID with no matching row → `notFound()` (page)
  / 404 JSON (API), same as today.
- **Numeric vs UUID disambiguation:** UUIDs always contain hyphens and hex
  letters, so `^\d+$` never matches a UUID — no collision.
- **Concurrent inserts:** the Postgres sequence guarantees unique, monotonic
  `ref` values under concurrency.
- **Re-running the migration:** every step is guarded (`IF NOT EXISTS`,
  `WHERE ref IS NULL`, constraint existence check) so it is idempotent.

## Testing

No test runner exists in this repo (per CLAUDE.md). Verification:

1. `npx tsc --noEmit` clean.
2. `npm run build` succeeds.
3. After migration: `curl /api/work/1000` and `curl /api/work/<uuid>` return the
   **same** row.
4. Create a new item via the `/work` modal → confirm it receives the next
   sequential `ref`.
5. Visit `/work/1009` in the browser → detail view renders; logs/dispatch still
   work (they go through the UUID).

Ship to `main` → Vercel auto-deploys to `dashboard.rosably.com`.

## Rollback

Additive and reversible: `ALTER TABLE work_items DROP COLUMN ref;`
`DROP SEQUENCE work_items_ref_seq;` plus reverting the route helper to
`.eq("id", id)`. No data loss (UUID PK untouched).
