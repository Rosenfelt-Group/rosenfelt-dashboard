# Friendly Work-Item IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every work item a short human-friendly integer id (`#1009`) shown in the dashboard and usable in the URL (`/work/1009`), without changing the UUID primary key.

**Architecture:** Add an additive, auto-incrementing `ref bigint` column (sequence starting at 1000) to `work_items`; the UUID stays the PK and every internal reference (agents, n8n, FKs) is untouched. The detail page and the single-item API route resolve an inbound `[id]` param as a numeric `ref` *or* a UUID, so old UUID links keep working. The board card, the search/flat-list row, and the detail header display `#ref` and link via the friendly number.

**Tech Stack:** Next.js 16 App Router (server components + route handlers), Supabase (Postgres via PostgREST / `supabaseAdmin`), TypeScript, Tailwind. No test runner in this repo — verification is `tsc --noEmit`, `npm run build`, and `curl` probes (per CLAUDE.md).

**Spec:** `docs/superpowers/specs/2026-06-01-friendly-work-item-ids-design.md`

**Repo / deploy:** `/opt/rosenfelt/rosenfelt-dashboard`, default branch `main`, auto-deploys to `dashboard.rosably.com` on push. Migration applied via Supabase Management API (`mcp__claude_ai_Supabase__apply_migration`); migration file is committed to the **docs** repo at `/opt/rosenfelt/docs/migrations/`.

**Commit/push policy:** Make small local commits per task. **Apply the migration (Task 1) before any code is deployed.** Do NOT `git push` the dashboard until Task 7 verification passes — pushing to `main` deploys to production immediately.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `/opt/rosenfelt/docs/migrations/2026-06-01-work-items-ref.sql` | Create | Idempotent migration: add `ref`, backfill, sequence, constraints |
| `src/types/index.ts` | Modify (`WorkItem` interface, ~line 117) | Add `ref: number` field |
| `src/lib/work-item-id.ts` | Create | `workItemIdFilter(id)` helper — numeric→`ref`, else→`id` |
| `src/app/(dashboard)/work/[id]/page.tsx` | Modify (~line 13-18) | Resolve loader query via helper |
| `src/app/api/work/[id]/route.ts` | Modify (GET ~14-20, PATCH ~30-80) | Resolve GET + PATCH target via helper |
| `src/components/work/KanbanCard.tsx` | Modify (line 67, ~116) | Link via `item.ref`; show `#ref` |
| `src/app/(dashboard)/work/page.tsx` | Modify (flat-list row, line ~985 + ~1003) | Link via `item.ref`; show `#ref` |
| `src/app/(dashboard)/work/[id]/WorkItemDetail.tsx` | Modify (~line 376) | Show `#ref` next to title |

No sub-route changes: `WorkItemDetail` uses `item.id` (the resolved UUID from `initial`) for all `/api/work/[id]/*` sub-calls (verified: lines 116, 197, 244, 262 all use `item.id`), so `dispatch`/`logs`/`status-check`/`write-prompt`/`resend-audit`/`deliverable.pdf`/`docs` stay UUID-only.

---

## Task 1: Database migration — add `ref` column

**Files:**
- Create: `/opt/rosenfelt/docs/migrations/2026-06-01-work-items-ref.sql`

- [ ] **Step 1: Write the migration file**

Write `/opt/rosenfelt/docs/migrations/2026-06-01-work-items-ref.sql`:

```sql
-- 2026-06-01: Friendly work-item IDs. Additive integer `ref` (sequence from
-- 1000). UUID `id` stays the PK; nothing internal changes. Idempotent.

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS ref bigint;

-- Backfill un-numbered rows by age, starting at 1000.
WITH ordered AS (
  SELECT id, (row_number() OVER (ORDER BY created_at, id) + 999) AS rn
  FROM work_items
  WHERE ref IS NULL
)
UPDATE work_items w SET ref = o.rn FROM ordered o WHERE w.id = o.id;

-- Sequence drives new inserts, continuing after the current max.
CREATE SEQUENCE IF NOT EXISTS work_items_ref_seq;
SELECT setval('work_items_ref_seq', (SELECT COALESCE(MAX(ref), 999) FROM work_items));
ALTER TABLE work_items ALTER COLUMN ref SET DEFAULT nextval('work_items_ref_seq');

-- Integrity.
ALTER TABLE work_items ALTER COLUMN ref SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_ref_key') THEN
    ALTER TABLE work_items ADD CONSTRAINT work_items_ref_key UNIQUE (ref);
  END IF;
END $$;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP tool `mcp__claude_ai_Supabase__apply_migration` with name `work_items_ref` and the SQL above. Expected: `{"success": true}`.

- [ ] **Step 3: Verify backfill, default, and constraint**

Run via `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT
  (SELECT count(*) FROM work_items WHERE ref IS NULL) AS null_refs,
  (SELECT min(ref) FROM work_items) AS min_ref,
  (SELECT count(*) <> count(DISTINCT ref) FROM work_items) AS has_dupe_refs,
  (SELECT last_value FROM work_items_ref_seq) AS seq_last;
```
Expected: `null_refs = 0`, `min_ref = 1000`, `has_dupe_refs = false`, `seq_last >= max(ref)`.

- [ ] **Step 4: Commit the migration file (docs repo)**

```bash
cd /opt/rosenfelt/docs && git add migrations/2026-06-01-work-items-ref.sql \
  && git commit -m "migration: add work_items.ref (friendly id, seq from 1000)" \
  && git push origin main
```

---

## Task 2: Add `ref` to the WorkItem type

**Files:**
- Modify: `src/types/index.ts` (`WorkItem` interface, after `id: string;` ~line 118)

- [ ] **Step 1: Add the field**

In `src/types/index.ts`, inside `export interface WorkItem {`, immediately after `id: string;`:

```ts
  id: string;
  /** Friendly, human-facing sequential id (from 1000). Used in /work/<ref> URLs and the UI. */
  ref: number;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0 (adding a field that the DB now returns introduces no errors).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts && git commit -m "types: add WorkItem.ref"
```

---

## Task 3: Route-resolution helper

**Files:**
- Create: `src/lib/work-item-id.ts`

- [ ] **Step 1: Write the helper**

Create `src/lib/work-item-id.ts`:

```ts
// Resolves an inbound /work/[id] param to the correct work_items column.
// A purely-numeric param is a friendly `ref`; anything else is the UUID `id`
// (UUIDs always contain hyphens/hex letters, so they never match /^\d+$/).
export function workItemIdFilter(
  id: string,
): { column: "ref" | "id"; value: number | string } {
  return /^\d+$/.test(id)
    ? { column: "ref", value: Number(id) }
    : { column: "id", value: id };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0. (An exported-but-unused function is not an error.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/work-item-id.ts && git commit -m "feat: add workItemIdFilter helper"
```

---

## Task 4: Dual resolution in the detail page loader

**Files:**
- Modify: `src/app/(dashboard)/work/[id]/page.tsx` (lines 13-18)

- [ ] **Step 1: Use the helper in the server loader**

Add the import at the top of the file (after the existing imports):

```ts
import { workItemIdFilter } from "@/lib/work-item-id";
```

Replace lines 13-18:

```ts
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("work_items")
    .select("*")
    .eq("id", id)
    .single();
```

with:

```ts
  const { id } = await params;
  const { column, value } = workItemIdFilter(id);
  const { data, error } = await supabaseAdmin
    .from("work_items")
    .select("*")
    .eq(column, value)
    .single();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/work/[id]/page.tsx" \
  && git commit -m "feat(work): resolve detail page by ref or uuid"
```

---

## Task 5: Dual resolution in the single-item API route

**Files:**
- Modify: `src/app/api/work/[id]/route.ts` (GET ~14-20, PATCH ~30-80)

- [ ] **Step 1: Read the current route to confirm GET and PATCH structure**

Run: `sed -n '1,90p' src/app/api/work/[id]/route.ts`
Note: GET does `.eq("id", id)` (~line 20). PATCH reads `id` (~line 32) and uses it in a status pre-fetch `.eq("id", id)` (~line 58) and the final update `.eq("id", id)` (~line 79).

- [ ] **Step 2: Add the import**

At the top of `src/app/api/work/[id]/route.ts`, after the existing imports:

```ts
import { workItemIdFilter } from "@/lib/work-item-id";
```

- [ ] **Step 3: Update GET**

In the GET handler, replace:

```ts
    const { id } = await ctx.params;
```
…and the query line `.eq("id", id)` so the block reads:

```ts
    const { id } = await ctx.params;
    const { column, value } = workItemIdFilter(id);
```
and change `.eq("id", id)` → `.eq(column, value)`.

- [ ] **Step 4: Update PATCH**

In the PATCH handler, right after `const { id } = await ctx.params;` add:

```ts
    const { column, value } = workItemIdFilter(id);
```
Then change **every** `.eq("id", id)` in PATCH (the status pre-fetch ~line 58 and the final update ~line 79) to `.eq(column, value)`.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/work/[id]/route.ts" \
  && git commit -m "feat(work): resolve item GET/PATCH by ref or uuid"
```

---

## Task 6: Display `#ref` and link via the friendly id

**Files:**
- Modify: `src/components/work/KanbanCard.tsx` (line 67, ~116)
- Modify: `src/app/(dashboard)/work/page.tsx` (flat-list row ~985, ~1003)
- Modify: `src/app/(dashboard)/work/[id]/WorkItemDetail.tsx` (~line 376)

- [ ] **Step 1: KanbanCard — link via ref**

In `src/components/work/KanbanCard.tsx` line 67, change:

```tsx
      onClick={() => router.push(`/work/${item.id}`)}
```
to:

```tsx
      onClick={() => router.push(`/work/${item.ref}`)}
```

- [ ] **Step 2: KanbanCard — show `#ref` on the card title row**

In `src/components/work/KanbanCard.tsx`, replace the title block (~lines 116-118):

```tsx
      <div className="text-sm font-medium text-brand-black mb-2 line-clamp-2">
        {item.title}
      </div>
```
with:

```tsx
      <div className="text-sm font-medium text-brand-black mb-2 line-clamp-2">
        <span className="text-brand-muted font-normal mr-1">#{item.ref}</span>
        {item.title}
      </div>
```

- [ ] **Step 3: Flat-list row — link via ref**

In `src/app/(dashboard)/work/page.tsx` (~line 985), change:

```tsx
      onClick={() => router.push(`/work/${item.id}`)}
```
to:

```tsx
      onClick={() => router.push(`/work/${item.ref}`)}
```

- [ ] **Step 4: Flat-list row — show `#ref` before the title**

In `src/app/(dashboard)/work/page.tsx`, replace the title span (~line 1003):

```tsx
      <span className="flex-1 min-w-0 truncate text-sm text-brand-black">{item.title}</span>
```
with:

```tsx
      <span className="flex-1 min-w-0 truncate text-sm text-brand-black">
        <span className="text-brand-muted mr-1">#{item.ref}</span>
        {item.title}
      </span>
```

- [ ] **Step 5: Detail header — show `#ref` next to the title**

In `src/app/(dashboard)/work/[id]/WorkItemDetail.tsx`, replace the non-editing title (~lines 376-378):

```tsx
          <h1 className="text-xl font-semibold text-brand-black mt-2">
            {item.title}
          </h1>
```
with:

```tsx
          <h1 className="text-xl font-semibold text-brand-black mt-2">
            <span className="text-brand-muted font-normal mr-2">#{item.ref}</span>
            {item.title}
          </h1>
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0 (`item.ref` is now on the `WorkItem` type from Task 2).

- [ ] **Step 7: Commit**

```bash
git add src/components/work/KanbanCard.tsx "src/app/(dashboard)/work/page.tsx" \
  "src/app/(dashboard)/work/[id]/WorkItemDetail.tsx" \
  && git commit -m "feat(work): display #ref and link via friendly id"
```

---

## Task 7: Build, end-to-end verify, deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Production build**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npm run build`
Expected: build completes, exit 0. (Requires `.env.local` with Supabase vars; if absent, rely on `tsc --noEmit` + the Vercel preview build.)

- [ ] **Step 2: Verify dual resolution against the live DB (dev server or curl)**

With a dev server running (`npm run dev`) and authenticated, or by hitting the deployed preview, confirm both forms resolve the same row:
```bash
# numeric ref
curl -s "http://localhost:3000/api/work/1000" | python3 -c "import sys,json;d=json.load(sys.stdin);print('ref',d.get('ref'),'id',d.get('id'))"
# uuid (use the id printed above)
curl -s "http://localhost:3000/api/work/<that-uuid>" | python3 -c "import sys,json;d=json.load(sys.stdin);print('ref',d.get('ref'),'id',d.get('id'))"
```
Expected: both print the same `ref` and `id`. (API routes are auth-gated; run against an authenticated session, or verify on the Vercel preview after push.)

- [ ] **Step 3: Push to deploy**

```bash
git push origin main
```
Expected: `main` updated; Vercel begins a production deploy.

- [ ] **Step 4: Confirm the deploy is live**

Run: `vercel inspect dashboard.rosably.com` (poll until `created` is recent / `status ● Ready`).
Then in the browser: open `/work`, click a card → URL is `/work/<ref>` and the detail view renders; confirm `#<ref>` shows on cards and the detail header; confirm an old `/work/<uuid>` link still resolves.

- [ ] **Step 5: Verify a fresh insert auto-numbers**

Create a new item via the `/work` "New item" modal. Expected: it appears with the next sequential `#ref` (no code sets `ref` — the column DEFAULT does).

---

## Self-Review Notes

- **Spec coverage:** migration (Task 1), route resolution (Tasks 4-5), type (Task 2) + helper (Task 3), display + links (Task 6), testing/deploy (Task 7), backward-compat UUID resolution (Tasks 4-5), new-insert auto-numbering (Task 1 Step 1 default + Task 7 Step 5). All spec sections covered.
- **No placeholders:** every code step shows the exact before/after.
- **Type consistency:** `workItemIdFilter` returns `{ column, value }` and is destructured identically in Tasks 4 and 5; `item.ref` (added in Task 2) is used in Task 6; `ref: number` matches the `bigint NOT NULL` column.
- **Order dependency:** Task 1 (migration) must complete before Task 7 deploys code that queries/returns `ref`. Local commits are fine throughout; the single `git push` is gated to Task 7.
