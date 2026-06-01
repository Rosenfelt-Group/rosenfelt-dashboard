# Advanced Search — Design Spec

**Date:** 2026-06-01
**Repo:** `Rosenfelt-Group/dashboard` (`/opt/rosenfelt/rosenfelt-dashboard`)
**Status:** Approved — ready for implementation plan
**Depends on:** Friendly Work-Item IDs (shipped 2026-06-01) — search rows show `#ref` and link via `/work/<ref>`.

## Problem

The `/work` filter bar filters **client-side** over only the loaded board
(active, non-archived, newest 500). There is no way to query the *full*
`work_items` history by an arbitrary combination of dimensions, and **no date
filtering anywhere**. Brian wants to search by keyword **and** agent, type,
priority, source, phase, status, and date — across everything.

## Goal

A self-contained Advanced Search that queries the entire `work_items` table on
any combination of fields + a date range, and lists matching items, without
disturbing the existing Kanban board or its filter bar.

## Decisions (from brainstorming)

- **Form factor:** a slide-over **drawer** opened by an "⌕ Advanced Search"
  button in the `/work` header. Board untouched.
- **Date filter:** one dropdown to pick the field (Created / Updated / Due) +
  `from` and `to` date inputs.
- **Default scope** (no status/type chosen): all statuses, internal + client,
  **archived excluded** unless "include archived" is ticked.
- **Pagination:** page size **50** with a **Load more** button (offset-based);
  the endpoint returns the total count so the button hides when exhausted.
- **Results:** compact rows — `#ref · title · agent · status · priority · phase ·
  date` — that **open the existing `/work/[id]` detail view** (link via `ref`).
- **State** is local to the drawer (not URL-synced) for v1.

## Non-Goals (v1)

- No URL-shareable search state.
- No CSV export, no saved searches.
- No change to the board, its filter bar, or the board's `MultiSelect`
  component (explicitly left untouched to avoid regressions).

## Architecture

### 1. Backend — new endpoint `GET /api/work/search`

A dedicated route, separate from `/api/work` (board) so neither affects the
other. Query params (all optional):

| Param | Type | Behavior |
|---|---|---|
| `q` | string | keyword; sanitized `[(),%*]→space`, then `.or(title.ilike.%q%,description.ilike.%q%,summary.ilike.%q%)` |
| `agent` | csv | `assigned_agent in (…)`; the `unassigned` sentinel → `assigned_agent is null` (combined via `.or` when both present) |
| `type` | csv | `work_type in (…)` |
| `priority` | csv | `priority in (…)` |
| `source` | csv | `source in (…)` |
| `status` | csv | `status in (…)` |
| `phase` | csv of int buckets + `none` | `.or(and(sprint_number.gte.N,sprint_number.lt.N+1),…,sprint_number.is.null)` |
| `itemType` | `internal`\|`client`\|`all` | `work_item_type eq …`; `all`/absent → no filter |
| `dateField` | `created_at`\|`updated_at`\|`due_date` | which column the range applies to; default `updated_at` |
| `from` | YYYY-MM-DD | `.gte(dateField, from)` |
| `to` | YYYY-MM-DD | `.lte(dateField, toEndOfDay)` where a date-only `to` gets `T23:59:59.999Z` appended so the end day is inclusive |
| `includeArchived` | `1`\|`0` | when not `1` → `archived eq false`; when `1` → no archived filter |
| `offset` | int | pagination offset (default 0) |

**Defaults with no params:** no status/type/agent/etc. filters, `includeArchived`
off → `archived eq false`. That yields "everything except archived".

**Count + page:** `supabaseAdmin.from("work_items").select("*", { count: "exact" })`
then `.order(dateField, { ascending: false }).range(offset, offset + 49)`.
Returns `{ items, total, offset, limit: 50 }`. No `work_item_logs` join (keep
search fast).

**PostgREST notes:** multiple `.or()` calls AND together at the top level, so
keyword-OR, phase-OR, and agent-OR compose correctly with the `.in()`/`.eq()`
filters. `unassigned` and phase `none` are handled inside their `.or()` clause.

### 2. Shared constants module — `src/components/work/work-constants.ts`

Move the **pure** option data out of `work/page.tsx` so both the board and the
drawer use one source of truth (no duplication / drift):
`WORK_TYPES`, `AGENT_FILTER_OPTIONS`, `PRIORITIES`, `SOURCES`,
`ITEM_TYPE_FILTERS`, `STATUS_PILL`, `STATUS_LABEL`, `ALL_STATUSES`,
`PHASE_NONE`, `phaseBucket`. `work/page.tsx` imports them and deletes its local
copies. **Interactive components (`MultiSelect`, `PhaseMultiSelect`) stay in
`page.tsx` — only data/constants move.**

### 3. Frontend — `src/components/work/AdvancedSearchDrawer.tsx`

Self-contained slide-over. Holds all filter state locally. Contains:
- A small internal `DrawerMultiSelect` (checkbox dropdown) — purpose-built so the
  board's `MultiSelect` is never touched.
- Keyword input; agent/type/priority/source/status/phase multi-selects;
  internal/client/all toggle (**default `all`** for search); date-field `<select>`
  + two `<input type="date">`; "include archived" checkbox.
- **Search** + **Reset** buttons. Search fetches `/api/work/search?…&offset=0`.
- Results: compact rows (`#ref · title · agent badge · status pill · priority ·
  phase · the chosen date`) linking to `/work/${item.ref}`. Header shows
  "N results". **Load more** fetches the next 50 at `offset += 50` and appends;
  hidden once `items.length >= total`.

Phase bucket options come from the existing `GET /api/work/sprint-numbers`
(already returns integer buckets).

### 4. Wire-in — `src/app/(dashboard)/work/page.tsx`

Add an "⌕ Advanced Search" button to the header actions; an `advancedOpen`
state toggles `<AdvancedSearchDrawer open={advancedOpen} onClose={…} />`. No
other board behavior changes.

## Data Flow

1. User clicks "⌕ Advanced Search" → drawer opens.
2. User sets any fields → clicks **Search** → `GET /api/work/search?…&offset=0`.
3. Endpoint builds one PostgREST query, returns `{ items, total }`.
4. Drawer renders rows + "N results"; **Load more** appends the next page.
5. Clicking a row → `/work/<ref>` (existing detail view).

## Error Handling / Edge Cases

- **No matches:** "No items match." (total 0).
- **from > to:** returns empty — no special handling.
- **`to` end-of-day:** date-only `to` is made inclusive (`T23:59:59.999Z`).
- **`unassigned` + real agents:** handled via a combined `.or()`.
- **Fetch error:** drawer shows an inline error string; does not crash the board.

## Testing

No test runner (per CLAUDE.md). Verify with `tsc --noEmit` + `npm run build`,
plus authenticated `curl`/dev-server probes against `/api/work/search` for
representative combos: multi-agent, phase buckets, `dateField=created_at` range,
`includeArchived=1`, `q=` keyword, and pagination (`offset=50`). Ship to `main`
→ Vercel.

## Rollback

Additive only: delete `/api/work/search/route.ts` and
`AdvancedSearchDrawer.tsx`, remove the header button. The constants extraction
is behavior-neutral (imports vs local defs).
