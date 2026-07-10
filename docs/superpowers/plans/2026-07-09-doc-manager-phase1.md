# Doc Manager Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the dashboard's `/documents` page to surface and manage the full `doc_registry` metadata (`doc_type`, `audience`, `status`, `client_id`) plus index-health signals, with a data-table browser, faceted filtering, a full-screen reader, an edit drawer, and bulk operations.

**Architecture:** All reads stay on the existing authenticated Supabase path (`GET /api/docs/list`, extended with new columns). All writes (single + bulk metadata edits) go through new Route Handlers using the server-only `supabaseAdmin` client, gated by a new `manage_documents` permission enforced server-side. The page shifts from today's 3-pane master-detail layout to: KPI cards + facet rail + data table (flat or grouped-by-`doc_type`) as the default view, with row-click opening a full-screen (or docked-panel) markdown Reader, and a separate metadata edit Drawer that can be opened independently. No DDL, no indexer changes — confirmed in Phase 0 that `index_docs.py` never writes `doc_type`/`audience`/`status`/`client_id`/`description`, so dashboard-set metadata is never clobbered by the nightly reindex.

**Tech Stack:** Next.js App Router (TypeScript), Tailwind, `@supabase/supabase-js`, `react-markdown` + `remark-gfm` (already installed), `zod` + `rehype-sanitize` (new deps), `jose` (existing session JWT).

## Global Constraints

- Canonical enums (verified live against `doc_registry` CHECK constraints, project `ukfpmpxwdlpsjqbxreza`): `doc_type` ∈ `governance, strategy, marketing, technical, sop, rules, prompts, planning, logs`; `audience` ∈ `internal, public, client`; `status` ∈ `draft, active, archived, superseded`. Never write any other value (the DB still accepts legacy values but the app must not produce them).
- All writes to `doc_registry` MUST run server-side via `supabaseAdmin` (`src/lib/supabase-admin.ts`) — `doc_registry` RLS only grants `authenticated` role SELECT. Never add a client-side write policy.
- All new write routes MUST be gated by the new `manage_documents` permission (server-side, via a new `requirePermission` helper) — not just UI-hiding.
- Do NOT modify `doc_chunks`, `index_docs.py`, or any DDL/migration in this plan. The taxonomy-tightening migration is a separate, explicitly-approved step (not part of this work).
- `client_id` UI is built but visually de-emphasized ("future") — `crm.clients` has 0 rows today; don't block on it.
- Reindex stays exactly as-is: the existing "Reindex docs" button (`POST /api/tools/reindex-docs` → Jordan) is already live — do not remove or duplicate it.
- **No test runner is configured in this repo** (`package.json` has no `test` script, no Jest/Vitest/Playwright). Every task's verification step is: `npx tsc --noEmit` (typecheck), plus either an exact `curl` command with expected JSON (API tasks) or a manual dev-server browser check with exact expected behavior (UI tasks). Do not introduce a test framework — out of scope.
- **`npm run lint` is broken repo-wide, independent of this plan** — confirmed during worktree setup: Next.js 16.2.4 removed the `next lint` CLI command entirely, and no ESLint flat config (`eslint.config.*`) has been migrated in to replace it (`npx eslint` fails with "couldn't find a configuration file"). Do not attempt to fix the lint toolchain as part of this plan — out of scope. Every task's verification step therefore relies on `npx tsc --noEmit` only.
- **Live dev-server/curl/browser verification is blocked repo-wide by a stale `SUPABASE_SERVICE_ROLE_KEY` in this environment's `.env.local`, independent of this plan.** Confirmed directly: a raw `supabaseAdmin`-equivalent query against `dashboard_users` returns `"Invalid API key"` from Supabase itself — this is not a code bug, and it is not fixable by editing application code (do not "fix" it by changing `supabase-admin.ts` or hardcoding a key). It blocks login (so no `dashboard_session` cookie can ever be minted against this local server) and blocks every route that calls `supabaseAdmin` (i.e. every route this plan touches). Per explicit instruction, live verification for the remaining tasks is **skipped** — implementers verify with `npx tsc --noEmit` only, reason carefully through expected runtime behavior in their report (tracing the code path by hand, e.g. "given this request body, `DocMetadataPatchSchema.safeParse` would reject it because..."), and note "live verification blocked by pre-existing stale service role key, not run" as a standing, expected, non-blocking concern. Reviewers should not treat the absence of live-test evidence as a defect — verify correctness by reading the diff instead.
- Follow existing brand tokens exactly as already used in `documents/page.tsx` and `tailwind.config.ts`: `brand-orange` (#C05621), `brand-black` (#1C1C1E), `brand-offwhite` (#EFE7DC), `brand-cream` (#F6F1EB), `brand-muted` (#8A8178), `brand-border` (#E3D9CB). No new mockup exists — match this page's current look.
- Client-side permission fetch follows the existing convention (see `approvals/page.tsx:79-84`): `fetch("/api/auth/me")` → `{ permissions: string[] }` → gate UI with `can(permissions, "manage_documents")` from `@/lib/permissions`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | modify | add `zod`, `rehype-sanitize` |
| `src/lib/permissions.ts` | modify | add `manage_documents` permission |
| `src/lib/requirePermission.ts` | create | server-side permission gate (mirrors `requireAdmin.ts`) |
| `src/lib/doc-types.ts` | modify | add enum arrays, Zod schemas, health computation, status color map |
| `src/app/api/docs/clients/route.ts` | create | `GET` — client dropdown options from `crm.clients` |
| `src/app/api/docs/[id]/route.ts` | create | `PATCH` — single-doc metadata edit |
| `src/app/api/docs/bulk/route.ts` | create | `PATCH` — bulk metadata edit |
| `src/app/api/docs/list/route.ts` | modify | add `status`, `audience`, `client_id`, `storage_path` to select |
| `src/app/(dashboard)/documents/FacetRail.tsx` | create | left filter rail + KPI cards |
| `src/app/(dashboard)/documents/Reader.tsx` | create | full-screen / docked-panel markdown reader |
| `src/app/(dashboard)/documents/MetadataDrawer.tsx` | create | right-side metadata edit drawer |
| `src/app/(dashboard)/documents/BulkActionBar.tsx` | create | sticky bulk-action bar |
| `src/app/(dashboard)/documents/page.tsx` | modify | orchestrates state, data table, wiring |

---

### Task 1: Dependencies + permission plumbing

**Files:**
- Modify: `package.json`
- Modify: `src/lib/permissions.ts`
- Create: `src/lib/requirePermission.ts`

**Interfaces:**
- Produces: `requirePermission(req: NextRequest, permission: string): Promise<{ ok: true; username: string; role: string } | { ok: false; response: NextResponse }>` — used by Tasks 4 and 5.
- Produces: `"manage_documents"` as a valid member of `MANAGE_PERMISSIONS` / `Permission` — used by Tasks 4, 5, 11.

- [ ] **Step 1: Install new dependencies**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npm install zod rehype-sanitize`

Expected: `package.json` gains `"zod": "^3...."` and `"rehype-sanitize": "^6...."` (or current majors) under `dependencies`; `package-lock.json` updates; no errors.

- [ ] **Step 2: Add the `manage_documents` permission**

In `src/lib/permissions.ts`, replace:

```ts
export const MANAGE_PERMISSIONS = [
  "manage_approvals",
  "manage_budget",
  "manage_backlog",
  "use_chat",
  "manage_users",
  "manage_rbac",
] as const;
```

with:

```ts
export const MANAGE_PERMISSIONS = [
  "manage_approvals",
  "manage_budget",
  "manage_backlog",
  "use_chat",
  "manage_users",
  "manage_rbac",
  "manage_documents",
] as const;
```

And replace:

```ts
export const PERMISSION_LABELS: Record<Permission, string> = {
  view_overview:    "View Overview",
  view_tasks:       "View Tasks",
  view_approvals:   "View Approvals",
  view_crm:         "View CRM",
  view_content:     "View Content",
  view_documents:   "View Documents",
  view_agents:      "View Agents",
  view_intelligence:"View Intelligence",
  view_cost:        "View Cost",
  view_backlog:     "View Backlog",
  manage_approvals: "Approve / Reject",
  manage_budget:    "Edit Budgets",
  manage_backlog:   "Manage Backlog",
  use_chat:         "Use Chat",
  manage_users:     "Manage Users",
  manage_rbac:      "Manage Roles",
};
```

with:

```ts
export const PERMISSION_LABELS: Record<Permission, string> = {
  view_overview:    "View Overview",
  view_tasks:       "View Tasks",
  view_approvals:   "View Approvals",
  view_crm:         "View CRM",
  view_content:     "View Content",
  view_documents:   "View Documents",
  view_agents:      "View Agents",
  view_intelligence:"View Intelligence",
  view_cost:        "View Cost",
  view_backlog:     "View Backlog",
  manage_approvals: "Approve / Reject",
  manage_budget:    "Edit Budgets",
  manage_backlog:   "Manage Backlog",
  use_chat:         "Use Chat",
  manage_users:     "Manage Users",
  manage_rbac:      "Manage Roles",
  manage_documents: "Manage Documents",
};
```

`DEFAULT_PERMISSIONS.admin` already spreads `ALL_PERMISSIONS`, so admin automatically gains `manage_documents`. `viewer` stays view-only (no change needed there).

- [ ] **Step 3: Create the permission-gate helper**

Create `src/lib/requirePermission.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

type PermissionCheckResult =
  | { ok: true; username: string; role: string }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  req: NextRequest,
  permission: string,
): Promise<PermissionCheckResult> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const session = await verifySessionToken(token);
  if (!session || !session.permissions.includes(permission)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, username: session.username, role: session.role };
}
```

- [ ] **Step 4: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add package.json package-lock.json src/lib/permissions.ts src/lib/requirePermission.ts
git commit -m "feat: add manage_documents permission and server-side gate helper"
```

---

### Task 2: Extend `doc-types.ts` with schemas, arrays, and health computation

**Files:**
- Modify: `src/lib/doc-types.ts`

**Interfaces:**
- Consumes: nothing new (pure extension of existing file).
- Produces: `DOC_TYPES: DocType[]`, `DOC_AUDIENCES: DocAudience[]`, `DOC_STATUSES: DocStatus[]`, `DocTypeSchema`, `DocAudienceSchema`, `DocStatusSchema` (Zod), `DocMetadataPatchSchema`, `DocBulkPatchSchema` (Zod), `DOC_STATUS_COLORS: Record<DocStatus, string>`, `type DocHealth = "indexed" | "stale" | "not_indexed" | "n/a"`, `DOC_HEALTH_LABELS: Record<DocHealth, string>`, `computeHealth(doc: { status?: string | null; storage_path?: string | null; chunk_count?: number | null; last_indexed_at?: string | null; updated_at?: string | null }): DocHealth` — used by Tasks 7, 8, 11.

- [ ] **Step 1: Append to `src/lib/doc-types.ts`**

Add this content to the end of the existing file (after the `docStatusLabel` function):

```ts
import { z } from "zod";

// ── Canonical enum arrays (for iteration / dropdown building) ────────────────

export const DOC_TYPES: DocType[] = [
  "governance", "strategy", "marketing", "technical", "sop", "rules", "prompts", "planning", "logs",
];

export const DOC_AUDIENCES: DocAudience[] = ["internal", "public", "client"];

export const DOC_STATUSES: DocStatus[] = ["draft", "active", "archived", "superseded"];

// ── Zod schemas — single source of truth for server-side write validation ────

export const DocTypeSchema = z.enum(DOC_TYPES as [DocType, ...DocType[]]);
export const DocAudienceSchema = z.enum(DOC_AUDIENCES as [DocAudience, ...DocAudience[]]);
export const DocStatusSchema = z.enum(DOC_STATUSES as [DocStatus, ...DocStatus[]]);

export const DocMetadataPatchSchema = z
  .object({
    doc_type: DocTypeSchema.optional(),
    status: DocStatusSchema.optional(),
    audience: DocAudienceSchema.optional(),
    client_id: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: "Patch must include at least one field" });

export const DocBulkPatchSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  patch: z
    .object({
      doc_type: DocTypeSchema.optional(),
      status: DocStatusSchema.optional(),
      audience: DocAudienceSchema.optional(),
      client_id: z.string().uuid().nullable().optional(),
    })
    .refine((obj) => Object.keys(obj).length > 0, { message: "Patch must include at least one field" }),
});

// ── Status badge colors ───────────────────────────────────────────────────────

export const DOC_STATUS_COLORS: Record<DocStatus, string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-green-50 text-green-700 border-green-200",
  archived: "bg-gray-100 text-gray-600 border-gray-200",
  superseded: "bg-red-50 text-red-700 border-red-200",
};

// ── Index-health computation (single source of truth) ────────────────────────
// Stale = active/draft row where updated_at > last_indexed_at.
// Not indexed = chunk_count IS NULL on a non-archived, non-binary (no storage_path) row.

export type DocHealth = "indexed" | "stale" | "not_indexed" | "n/a";

export const DOC_HEALTH_LABELS: Record<DocHealth, string> = {
  indexed: "Indexed",
  stale: "Stale",
  not_indexed: "Not indexed",
  "n/a": "N/A",
};

export function computeHealth(doc: {
  status?: string | null;
  storage_path?: string | null;
  chunk_count?: number | null;
  last_indexed_at?: string | null;
  updated_at?: string | null;
}): DocHealth {
  const isBinary = !!doc.storage_path;
  if (isBinary) return "n/a";

  const isDraftOrActive = doc.status === "active" || doc.status === "draft";
  if (
    isDraftOrActive &&
    doc.last_indexed_at &&
    doc.updated_at &&
    new Date(doc.updated_at).getTime() > new Date(doc.last_indexed_at).getTime()
  ) {
    return "stale";
  }

  if (doc.status !== "archived" && doc.chunk_count == null) {
    return "not_indexed";
  }

  return "indexed";
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0. (Note: `doc-types.ts` had no imports before; adding `import { z } from "zod"` at the bottom is syntactically valid in TS but move it to the top of the file for style — place `import { z } from "zod";` as the first line of the file instead of inline mid-file.)

- [ ] **Step 3: Manual sanity check**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && node -e "const {computeHealth} = require('./node_modules/.bin/../../.next/server/... ')" ` — skip this; instead verify via a scratch TS check:

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsx -e "
import { computeHealth } from './src/lib/doc-types';
console.log(computeHealth({ status: 'active', storage_path: null, chunk_count: null, last_indexed_at: null, updated_at: null })); // expect not_indexed
console.log(computeHealth({ status: 'active', storage_path: null, chunk_count: 3, last_indexed_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' })); // expect stale
console.log(computeHealth({ status: 'active', storage_path: null, chunk_count: 3, last_indexed_at: '2026-02-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })); // expect indexed
console.log(computeHealth({ status: 'archived', storage_path: null, chunk_count: null, last_indexed_at: null, updated_at: null })); // expect indexed (archived exempt)
console.log(computeHealth({ status: 'active', storage_path: 'stack-audits/x.pdf', chunk_count: null, last_indexed_at: null, updated_at: null })); // expect n/a
"`

If `tsx` isn't available (`npx: command not found tsx`), run `npm install -D tsx` first (dev dep, fine to add for this one-off check, or just eyeball the logic — the four branches are straightforward). Expected output: `not_indexed`, `stale`, `indexed`, `indexed`, `n/a`.

- [ ] **Step 4: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/lib/doc-types.ts
git commit -m "feat: add doc_registry enum schemas and index-health computation"
```

---

### Task 3: `GET /api/docs/clients`

**Files:**
- Create: `src/app/api/docs/clients/route.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/supabase-admin`.
- Produces: `GET` returns `ClientOption[]` where `ClientOption = { id: string; name: string }` — consumed by Task 11 (page fetch) and Tasks 9/10 (drawer/bulk-bar dropdowns via props, not direct fetch).

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/docs/clients
// Dropdown source for doc_registry.client_id. crm.clients has no name column
// of its own — it references crm.businesses(name) via business_id.
export async function GET() {
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .select("id, businesses(name)")
    .order("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = { id: string; businesses: { name: string } | { name: string }[] | null };
  const clients = (data as Row[] ?? []).map((row) => {
    const biz = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
    return { id: row.id, name: biz?.name ?? "(unnamed)" };
  });

  return NextResponse.json(clients);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual verification against the dev server**

**Skipped per the Global Constraints note on the stale `SUPABASE_SERVICE_ROLE_KEY`** — even with a valid session cookie, this route's `supabaseAdmin` query would fail on the pre-existing invalid key, not your code. Instead, trace the code by hand: confirm the `.schema("crm").from("clients").select("id, businesses(name)")` query shape matches `crm.clients.business_id → crm.businesses.id` (verified live in Phase 0), and confirm the `Array.isArray(business) ? business[0] : business` handling covers both the array-embed and object-embed shapes PostgREST can return for a to-one relation. Record that reasoning in your report. The commands below are left as reference for whenever the key is fixed.

`src/middleware.ts` requires a valid `dashboard_session` cookie for every route except a small explicit allowlist (login, auth, webhooks, static assets) — `/api/docs/*` is not on that allowlist, so a bare curl gets redirected to `/login` (this is correct, existing, intentional behavior — do not modify `middleware.ts`).

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npm run dev &` then, once it's listening on port 3000:

Run: `curl -s http://localhost:3000/api/docs/clients -H "Cookie: dashboard_session=<paste real cookie value>"`
Expected: `[]` (since `crm.clients` currently has 0 rows — confirmed live in Phase 0). A non-error empty array confirms the schema/join resolves correctly even with no data.

Stop the dev server after checking (`kill %1` or note the PID).

- [ ] **Step 4: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/app/api/docs/clients/route.ts
git commit -m "feat: add GET /api/docs/clients for client_id dropdown"
```

---

### Task 4: `PATCH /api/docs/[id]` — single-doc metadata edit

**Files:**
- Create: `src/app/api/docs/[id]/route.ts`

**Interfaces:**
- Consumes: `requirePermission` (Task 1), `DocMetadataPatchSchema` (Task 2), `supabaseAdmin`.
- Produces: `PATCH /api/docs/:id` — body is a partial `{doc_type?, status?, audience?, client_id?, description?}`; returns the updated `doc_registry` row as JSON, or `{error}` with 400/401/403/404/500 — consumed by Task 9 (`MetadataDrawer`).

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { DocMetadataPatchSchema } from "@/lib/doc-types";

// PATCH /api/docs/[id]  (requires manage_documents)
// Edits doc_registry metadata only (doc_type/status/audience/client_id/description).
// Never touches content/headings/chunk_count/last_indexed_at — those are indexer-owned.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "manage_documents");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DocMetadataPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .update(parsed.data)
    .eq("id", idNum)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual verification against the dev server**

**Skipped per the Global Constraints note on the stale `SUPABASE_SERVICE_ROLE_KEY`** — do not attempt these curl commands (they will fail on the pre-existing key issue, not your code). Instead, trace the route's logic by hand against each described case (unauthenticated → 401, invalid body → 400 with the Zod error, valid patch → the exact Supabase call that would run) and record that reasoning in your report. The commands below are left as reference for whenever the key is fixed.

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npm run dev &`

Without a session cookie:

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3000/api/docs/1 -H "Content-Type: application/json" -d '{"status":"active"}'`
Expected: `401`

With an invalid body shape (log in via the browser first to get a real `dashboard_session` cookie for an admin user, then reuse it in curl):

Run: `curl -s -X PATCH http://localhost:3000/api/docs/1 -H "Content-Type: application/json" -H "Cookie: dashboard_session=<paste real cookie value>" -d '{"doc_type":"not_a_real_type"}'`
Expected: `400` with a Zod error body.

With a valid body against a real row id (pick any id from `select id, doc_type from doc_registry limit 1` — do not actually change production data during this manual check; instead PATCH the row back to its own current `doc_type` value so the operation is a no-op write):

Run: `curl -s -X PATCH http://localhost:3000/api/docs/<real-id> -H "Content-Type: application/json" -H "Cookie: dashboard_session=<paste real cookie value>" -d '{"doc_type":"<its-current-doc_type>"}'`
Expected: `200` with the full updated row JSON, `doc_type` unchanged.

Stop the dev server after checking.

- [ ] **Step 4: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/app/api/docs/\[id\]/route.ts
git commit -m "feat: add PATCH /api/docs/[id] for single-doc metadata edits"
```

---

### Task 5: `PATCH /api/docs/bulk` — bulk metadata edit

**Files:**
- Create: `src/app/api/docs/bulk/route.ts`

**Interfaces:**
- Consumes: `requirePermission` (Task 1), `DocBulkPatchSchema` (Task 2), `supabaseAdmin`.
- Produces: `PATCH /api/docs/bulk` — body `{ ids: number[], patch: {doc_type?, status?, audience?, client_id?} }`; returns `{ updated: number }` or `{error}` — consumed by Task 10 (`BulkActionBar`).

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { DocBulkPatchSchema } from "@/lib/doc-types";

// PATCH /api/docs/bulk  (requires manage_documents)
// Applies the same metadata patch to every id in the list, in one request.
export async function PATCH(req: NextRequest) {
  const guard = await requirePermission(req, "manage_documents");
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DocBulkPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { ids, patch } = parsed.data;

  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .update(patch)
    .in("id", ids)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ updated: data?.length ?? 0 });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual verification against the dev server**

**Skipped per the Global Constraints note on the stale `SUPABASE_SERVICE_ROLE_KEY`** — do not attempt these curl commands (they will fail on the pre-existing key issue, not your code). Instead, trace the route's logic by hand against each described case (unauthenticated → 401, invalid body → 400 with the Zod error, valid patch → the exact Supabase call that would run) and record that reasoning in your report. The commands below are left as reference for whenever the key is fixed.

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npm run dev &`

Empty `ids` array (should fail Zod min(1)):

Run: `curl -s -X PATCH http://localhost:3000/api/docs/bulk -H "Content-Type: application/json" -H "Cookie: dashboard_session=<paste real cookie value>" -d '{"ids":[],"patch":{"status":"active"}}'`
Expected: `400`

No-op bulk update on a real id, patching to its current value (avoid mutating real data — pick a row, note its current `status`, patch it back to that same value):

Run: `curl -s -X PATCH http://localhost:3000/api/docs/bulk -H "Content-Type: application/json" -H "Cookie: dashboard_session=<paste real cookie value>" -d '{"ids":[<real-id>],"patch":{"status":"<its-current-status>"}}'`
Expected: `200` with `{"updated":1}`.

Stop the dev server after checking.

- [ ] **Step 4: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/app/api/docs/bulk/route.ts
git commit -m "feat: add PATCH /api/docs/bulk for bulk metadata edits"
```

---

### Task 6: Extend `GET /api/docs/list` with the new columns

**Files:**
- Modify: `src/app/api/docs/list/route.ts`

**Interfaces:**
- Produces: each list item now additionally includes `status: string`, `audience: string`, `client_id: string | null`, `storage_path: string | null` — consumed by Task 11 (`DocEntry` interface + `computeHealth`).

- [ ] **Step 1: Extend the select**

In `src/app/api/docs/list/route.ts`, replace:

```ts
  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .select(
      "id, name, path, description, doc_type, updated_at, headings, last_indexed_at, chunk_count, work_item_id, work_items(title)"
    )
    .order("doc_type", { ascending: true })
    .order("name", { ascending: true });
```

with:

```ts
  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .select(
      "id, name, path, description, doc_type, status, audience, client_id, storage_path, updated_at, headings, last_indexed_at, chunk_count, work_item_id, work_items(title)"
    )
    .order("doc_type", { ascending: true })
    .order("name", { ascending: true });
```

No other changes needed in this file — the existing flatten/filter logic passes through unrecognized-to-it fields unchanged since it spreads `...rest`.

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual verification**

**Skipped per the Global Constraints note on the stale `SUPABASE_SERVICE_ROLE_KEY`** — instead, re-read the modified `select(...)` string character by character against the brief's required column list (`status, audience, client_id, storage_path` all present, nothing else dropped from the original select) and confirm the existing flatten/filter logic downstream still spreads `...rest` unchanged (so the new columns pass through untouched). Record that check in your report. The commands below are left as reference for whenever the key is fixed.

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npm run dev &` then:

`src/middleware.ts` requires a valid `dashboard_session` cookie for every route except a small explicit allowlist — log in via the browser first and copy the `dashboard_session` cookie value:

Run: `curl -s http://localhost:3000/api/docs/list -H "Cookie: dashboard_session=<paste real cookie value>" | head -c 500`
Expected: JSON array where each object now has `"status"`, `"audience"`, `"client_id"`, `"storage_path"` keys present (values per current data, e.g. `"status":"active","audience":"internal","client_id":null,"storage_path":null`).

Stop the dev server after checking.

- [ ] **Step 4: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/app/api/docs/list/route.ts
git commit -m "feat: include status/audience/client_id/storage_path in doc list"
```

---

### Task 7: `FacetRail` component (filters + KPI cards)

**Files:**
- Create: `src/app/(dashboard)/documents/FacetRail.tsx`

**Interfaces:**
- Consumes: `DocEntry` type (defined in Task 11's `page.tsx`, but this component declares its own minimal local shape to stay decoupled — see below), `ClientOption`, `DOC_TYPES`, `DOC_AUDIENCES`, `DOC_STATUSES`, `docTypeLabel`, `docAudienceLabel`, `docStatusLabel`, `computeHealth`, `DOC_HEALTH_LABELS` from `@/lib/doc-types`.
- Produces: exported `Filters` type `{ status: string; doc_type: string; audience: string; client: string; health: string }`, exported `EMPTY_FILTERS: Filters`, exported `applyFilters(docs: FacetDoc[], filters: Filters, q: string): FacetDoc[]`, exported default component `FacetRail(props: FacetRailProps)` — all consumed by Task 11.

- [ ] **Step 1: Create the component**

```tsx
"use client";
import {
  DOC_TYPES, DOC_AUDIENCES, DOC_STATUSES,
  docTypeLabel, docAudienceLabel, docStatusLabel,
  computeHealth, DOC_HEALTH_LABELS,
} from "@/lib/doc-types";
import clsx from "clsx";

export interface FacetDoc {
  id: number;
  name: string;
  path: string;
  doc_type: string;
  status: string;
  audience: string;
  client_id: string | null;
  storage_path?: string | null;
  chunk_count?: number | null;
  last_indexed_at?: string | null;
  updated_at?: string;
}

export interface ClientOption { id: string; name: string; }

export interface Filters {
  status: string;
  doc_type: string;
  audience: string;
  client: string;  // '' = all, 'unassigned' = client_id is null, else a client uuid
  health: string;  // '' = all, else a DocHealth value
}

export const EMPTY_FILTERS: Filters = { status: "", doc_type: "", audience: "", client: "", health: "" };

function matchesFilters(doc: FacetDoc, filters: Filters, q: string, skip?: keyof Filters): boolean {
  if (filters.status && skip !== "status" && doc.status !== filters.status) return false;
  if (filters.doc_type && skip !== "doc_type" && doc.doc_type !== filters.doc_type) return false;
  if (filters.audience && skip !== "audience" && doc.audience !== filters.audience) return false;
  if (filters.client && skip !== "client") {
    if (filters.client === "unassigned" ? doc.client_id !== null : doc.client_id !== filters.client) return false;
  }
  if (filters.health && skip !== "health" && computeHealth(doc) !== filters.health) return false;
  if (q.trim()) {
    const needle = q.trim().toLowerCase();
    if (!doc.name.toLowerCase().includes(needle) && !doc.path.toLowerCase().includes(needle)) return false;
  }
  return true;
}

export function applyFilters(docs: FacetDoc[], filters: Filters, q: string): FacetDoc[] {
  return docs.filter((d) => matchesFilters(d, filters, q));
}

function countBy(docs: FacetDoc[], filters: Filters, q: string, key: keyof Filters, value: string): number {
  const scoped = docs.filter((d) => matchesFilters(d, filters, q, key));
  if (key === "client") {
    return scoped.filter((d) => (value === "unassigned" ? d.client_id === null : d.client_id === value)).length;
  }
  if (key === "health") {
    return scoped.filter((d) => computeHealth(d) === value).length;
  }
  return scoped.filter((d) => (d as unknown as Record<string, string>)[key] === value).length;
}

function FacetSection({ title, options, activeValue, onSelect }: {
  title: string;
  options: { value: string; label: string; count: number }[];
  activeValue: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted mb-1.5 px-1">{title}</p>
      <div className="space-y-0.5">
        <button
          onClick={() => onSelect("")}
          className={clsx(
            "w-full flex items-center justify-between text-left text-xs px-2 py-1 rounded transition-colors",
            activeValue === "" ? "bg-brand-orange/10 text-brand-black font-medium" : "text-brand-muted hover:bg-brand-offwhite"
          )}
        >
          <span>All</span>
        </button>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(activeValue === opt.value ? "" : opt.value)}
            className={clsx(
              "w-full flex items-center justify-between text-left text-xs px-2 py-1 rounded transition-colors",
              activeValue === opt.value ? "bg-brand-orange/10 text-brand-black font-medium" : "text-brand-muted hover:bg-brand-offwhite"
            )}
          >
            <span className="truncate">{opt.label}</span>
            <span className="text-[10px] text-brand-muted ml-2 flex-shrink-0">{opt.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function KpiCard({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex-1 min-w-[100px] rounded-lg border px-3 py-2 text-left transition-colors",
        active ? "border-brand-orange bg-brand-orange/5" : "border-brand-border bg-white hover:bg-brand-offwhite"
      )}
    >
      <p className="text-lg font-semibold text-brand-black">{count}</p>
      <p className="text-[10px] text-brand-muted uppercase tracking-wide">{label}</p>
    </button>
  );
}

export function KpiRow({ docs, filters, q, onChange }: {
  docs: FacetDoc[]; filters: Filters; q: string; onChange: (patch: Partial<Filters>) => void;
}) {
  const total = docs.length;
  const active = docs.filter((d) => d.status === "active").length;
  const drafts = docs.filter((d) => d.status === "draft").length;
  const archived = docs.filter((d) => d.status === "archived").length;
  const issues = docs.filter((d) => {
    const h = computeHealth(d);
    return h === "stale" || h === "not_indexed";
  }).length;

  return (
    <div className="flex gap-2 flex-wrap mb-4">
      <KpiCard label="Total" count={total} active={filters.status === "" && filters.health === ""} onClick={() => onChange({ status: "", health: "" })} />
      <KpiCard label="Active" count={active} active={filters.status === "active"} onClick={() => onChange({ status: filters.status === "active" ? "" : "active" })} />
      <KpiCard label="Drafts" count={drafts} active={filters.status === "draft"} onClick={() => onChange({ status: filters.status === "draft" ? "" : "draft" })} />
      <KpiCard label="Archived" count={archived} active={filters.status === "archived"} onClick={() => onChange({ status: filters.status === "archived" ? "" : "archived" })} />
      <KpiCard label="Index issues" count={issues} active={filters.health === "stale" || filters.health === "not_indexed"} onClick={() => onChange({ health: filters.health ? "" : "stale" })} />
    </div>
  );
}

export default function FacetRail({ docs, clients, filters, q, onChange }: {
  docs: FacetDoc[];
  clients: ClientOption[];
  filters: Filters;
  q: string;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const statusOptions = DOC_STATUSES.map((s) => ({ value: s, label: docStatusLabel(s), count: countBy(docs, filters, q, "status", s) }));
  const typeOptions = DOC_TYPES.map((t) => ({ value: t, label: docTypeLabel(t), count: countBy(docs, filters, q, "doc_type", t) }));
  const audienceOptions = DOC_AUDIENCES.map((a) => ({ value: a, label: docAudienceLabel(a), count: countBy(docs, filters, q, "audience", a) }));
  const clientOptions = [
    { value: "unassigned", label: "Rosably (unassigned)", count: countBy(docs, filters, q, "client", "unassigned") },
    ...clients.map((c) => ({ value: c.id, label: c.name, count: countBy(docs, filters, q, "client", c.id) })),
  ];
  const healthOptions = (["indexed", "stale", "not_indexed"] as const).map((h) => ({
    value: h, label: DOC_HEALTH_LABELS[h], count: countBy(docs, filters, q, "health", h),
  }));

  return (
    <div className="w-52 flex-shrink-0 overflow-y-auto">
      <FacetSection title="Status" options={statusOptions} activeValue={filters.status} onSelect={(v) => onChange({ status: v })} />
      <FacetSection title="Doc type" options={typeOptions} activeValue={filters.doc_type} onSelect={(v) => onChange({ doc_type: v })} />
      <FacetSection title="Audience" options={audienceOptions} activeValue={filters.audience} onSelect={(v) => onChange({ audience: v })} />
      <FacetSection title="Client scope" options={clientOptions} activeValue={filters.client} onSelect={(v) => onChange({ client: v })} />
      <FacetSection title="Index health" options={healthOptions} activeValue={filters.health} onSelect={(v) => onChange({ health: v })} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0. (This component isn't wired into any page yet, so it can't be manually exercised until Task 11 — typecheck/lint passing is the full verification for this task.)

- [ ] **Step 3: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/app/\(dashboard\)/documents/FacetRail.tsx
git commit -m "feat: add FacetRail filter/KPI component for doc manager"
```

---

### Task 8: `Reader` component (full-screen / docked markdown reader)

**Files:**
- Create: `src/app/(dashboard)/documents/Reader.tsx`

**Interfaces:**
- Consumes: `react-markdown`, `remark-gfm`, `rehype-sanitize` (installed Task 1), `docTypeLabel`/`docAudienceLabel`/`docStatusLabel`/`DOC_STATUS_COLORS` from `@/lib/doc-types`.
- Produces: exported default component `Reader(props: ReaderProps)` where
  `ReaderProps = { doc: ReaderDoc; mode: "fullscreen" | "panel"; onClose: () => void; onToggleMode: () => void; onEditMetadata: () => void }` and
  `ReaderDoc = { id: number; name: string; path: string; doc_type: string; status: string; audience: string }` — consumed by Task 11.

- [ ] **Step 1: Create the component**

```tsx
"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import clsx from "clsx";
import { docTypeLabel, docAudienceLabel, docStatusLabel, DOC_STATUS_COLORS, DocStatus } from "@/lib/doc-types";

export interface ReaderDoc {
  id: number;
  name: string;
  path: string;
  doc_type: string;
  status: string;
  audience: string;
}

export interface ReaderProps {
  doc: ReaderDoc;
  mode: "fullscreen" | "panel";
  onClose: () => void;
  onToggleMode: () => void;
  onEditMetadata: () => void;
}

export default function Reader({ doc, mode, onClose, onToggleMode, onEditMetadata }: ReaderProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    fetch(`/api/docs?path=${encodeURIComponent(doc.path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setContent(data.content ?? "");
      })
      .catch(() => { if (!cancelled) setError("Network error loading file"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [doc.path]);

  useEffect(() => {
    if (mode !== "fullscreen") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const statusColor = DOC_STATUS_COLORS[doc.status as DocStatus] ?? "bg-gray-100 text-gray-600 border-gray-200";

  const body = (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-brand-border flex items-center gap-3 flex-wrap flex-shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-black truncate">{doc.name}</p>
          <p className="text-[11px] text-brand-muted font-mono truncate">{doc.path}</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded border bg-brand-offwhite text-brand-black border-brand-border">
          {docTypeLabel(doc.doc_type)}
        </span>
        <span className={clsx("text-[10px] px-2 py-0.5 rounded border", statusColor)}>
          {docStatusLabel(doc.status)}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded border bg-brand-offwhite text-brand-black border-brand-border">
          {docAudienceLabel(doc.audience)}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onEditMetadata} className="text-xs px-2.5 py-1 rounded border border-brand-border hover:bg-brand-offwhite text-brand-black">
            Edit metadata
          </button>
          <button onClick={onToggleMode} className="text-xs px-2.5 py-1 rounded border border-brand-border hover:bg-brand-offwhite text-brand-black">
            {mode === "fullscreen" ? "Collapse to panel" : "Expand"}
          </button>
          <button onClick={onClose} className="text-xs px-2.5 py-1 rounded border border-brand-border hover:bg-brand-offwhite text-brand-black">
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[900px] mx-auto px-8 py-8">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="animate-pulse h-4 bg-brand-offwhite rounded" style={{ width: `${60 + i * 8}%` }} />)}
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg p-4">{error}</div>
          ) : !content ? (
            <div className="text-center py-16">
              <p className="text-sm text-brand-muted">No indexed content yet.</p>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none
              prose-headings:font-semibold prose-headings:text-brand-black
              prose-p:text-brand-black prose-p:leading-relaxed
              prose-a:text-brand-orange prose-a:no-underline hover:prose-a:underline
              prose-strong:text-brand-black prose-li:text-brand-black
              prose-code:bg-gray-200 prose-code:text-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
              prose-pre:bg-gray-200 prose-pre:text-gray-800 prose-pre:rounded-lg prose-pre:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (mode === "fullscreen") {
    return <div className="fixed inset-0 z-50">{body}</div>;
  }
  return <div className="w-[45%] flex-shrink-0 border-l border-brand-border h-full">{body}</div>;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/app/\(dashboard\)/documents/Reader.tsx
git commit -m "feat: add full-screen/docked Reader component for doc manager"
```

---

### Task 9: `MetadataDrawer` component

**Files:**
- Create: `src/app/(dashboard)/documents/MetadataDrawer.tsx`

**Interfaces:**
- Consumes: `PATCH /api/docs/:id` (Task 4), `DOC_TYPES`/`DOC_AUDIENCES`/`DOC_STATUSES`/label helpers/`computeHealth`/`DOC_HEALTH_LABELS` from `@/lib/doc-types`, `ClientOption` (local shape matching Task 3's response).
- Produces: exported default component `MetadataDrawer(props: MetadataDrawerProps)` where
  `MetadataDrawerProps = { doc: DrawerDoc; clients: ClientOption[]; onClose: () => void; onSaved: (updated: DrawerDoc) => void }` and
  `DrawerDoc = { id: number; name: string; path: string; doc_type: string; status: string; audience: string; client_id: string | null; description: string | null; chunk_count: number | null; last_indexed_at: string | null; updated_at?: string; storage_path: string | null }` — consumed by Task 11.

- [ ] **Step 1: Create the component**

```tsx
"use client";
import { useState } from "react";
import clsx from "clsx";
import {
  DOC_TYPES, DOC_AUDIENCES, DOC_STATUSES,
  docTypeLabel, docAudienceLabel, docStatusLabel,
  computeHealth, DOC_HEALTH_LABELS,
} from "@/lib/doc-types";
import { formatDistanceToNow, parseISO } from "date-fns";

export interface ClientOption { id: string; name: string; }

export interface DrawerDoc {
  id: number;
  name: string;
  path: string;
  doc_type: string;
  status: string;
  audience: string;
  client_id: string | null;
  description: string | null;
  chunk_count: number | null;
  last_indexed_at: string | null;
  updated_at?: string;
  storage_path: string | null;
}

export interface MetadataDrawerProps {
  doc: DrawerDoc;
  clients: ClientOption[];
  onClose: () => void;
  onSaved: (updated: DrawerDoc) => void;
}

export default function MetadataDrawer({ doc, clients, onClose, onSaved }: MetadataDrawerProps) {
  const [tab, setTab] = useState<"details" | "preview">("details");
  const [docType, setDocType] = useState(doc.doc_type);
  const [status, setStatus] = useState(doc.status);
  const [audience, setAudience] = useState(doc.audience);
  const [clientId, setClientId] = useState<string>(doc.client_id ?? "");
  const [description, setDescription] = useState(doc.description ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const health = computeHealth(doc);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const patch: Record<string, unknown> = {};
    if (docType !== doc.doc_type) patch.doc_type = docType;
    if (status !== doc.status) patch.status = status;
    if (audience !== doc.audience) patch.audience = audience;
    if ((clientId || null) !== doc.client_id) patch.client_id = clientId || null;
    if (description !== (doc.description ?? "")) patch.description = description || null;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    try {
      const res = await fetch(`/api/docs/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ? JSON.stringify(data.error) : "Save failed");
        setSaving(false);
        return;
      }
      onSaved({ ...doc, ...data });
    } catch {
      setSaveError("Network error saving changes");
      setSaving(false);
    }
  }

  return (
    <div className="w-[440px] flex-shrink-0 border-l border-brand-border h-full flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between flex-shrink-0">
        <p className="text-sm font-semibold text-brand-black truncate">{doc.name}</p>
        <button onClick={onClose} className="text-xs text-brand-muted hover:text-brand-black">Close</button>
      </div>

      <div className="flex border-b border-brand-border flex-shrink-0">
        {(["details", "preview"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "flex-1 text-xs font-medium py-2 border-b-2 transition-colors",
              tab === t ? "border-brand-orange text-brand-black" : "border-transparent text-brand-muted hover:text-brand-black"
            )}
          >
            {t === "details" ? "Details" : "Preview"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "preview" ? (
          <div className="text-xs text-brand-muted">
            <p><span className="font-semibold text-brand-black">Path:</span> {doc.path}</p>
            <p className="mt-2"><span className="font-semibold text-brand-black">Description:</span> {description || "—"}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Doc type</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange">
                {DOC_TYPES.map((t) => <option key={t} value={t}>{docTypeLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange">
                {DOC_STATUSES.map((s) => <option key={s} value={s}>{docStatusLabel(s)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value)}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange">
                {DOC_AUDIENCES.map((a) => <option key={a} value={a}>{docAudienceLabel(a)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">
                Client <span className="text-brand-muted normal-case">(future)</span>
              </label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange text-brand-muted">
                <option value="">Rosably (unassigned)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange resize-none" />
            </div>

            <div className="border-t border-brand-border pt-3">
              <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide mb-2">Index health</p>
              <div className="text-xs text-brand-black space-y-1">
                <p>Status: <span className="font-medium">{DOC_HEALTH_LABELS[health]}</span></p>
                <p>Chunks: {doc.chunk_count ?? "—"}</p>
                <p>Last indexed: {doc.last_indexed_at ? formatDistanceToNow(parseISO(doc.last_indexed_at), { addSuffix: true }) : "never"}</p>
                {doc.storage_path && <p>Storage path: <span className="font-mono text-[11px]">{doc.storage_path}</span></p>}
              </div>
            </div>

            {saveError && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{saveError}</div>}

            <button onClick={handleSave} disabled={saving}
              className={clsx(
                "w-full text-sm font-medium py-2 rounded-lg transition-colors",
                saving ? "bg-brand-offwhite text-brand-muted cursor-not-allowed" : "bg-brand-orange text-white hover:bg-brand-orange-dark"
              )}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/app/\(dashboard\)/documents/MetadataDrawer.tsx
git commit -m "feat: add MetadataDrawer component for doc manager"
```

---

### Task 10: `BulkActionBar` component

**Files:**
- Create: `src/app/(dashboard)/documents/BulkActionBar.tsx`

**Interfaces:**
- Consumes: `PATCH /api/docs/bulk` (Task 5), `DOC_TYPES`/`DOC_AUDIENCES`/`DOC_STATUSES`/label helpers from `@/lib/doc-types`, `ClientOption` (Task 3's response shape).
- Produces: exported default component `BulkActionBar(props: BulkActionBarProps)` where
  `BulkActionBarProps = { selectedIds: number[]; clients: ClientOption[]; onClear: () => void; onApplied: () => void }` — consumed by Task 11.

- [ ] **Step 1: Create the component**

```tsx
"use client";
import { useState } from "react";
import clsx from "clsx";
import { DOC_TYPES, DOC_AUDIENCES, DOC_STATUSES, docTypeLabel, docAudienceLabel, docStatusLabel } from "@/lib/doc-types";

export interface ClientOption { id: string; name: string; }

export interface BulkActionBarProps {
  selectedIds: number[];
  clients: ClientOption[];
  onClear: () => void;
  onApplied: () => void;
}

type Field = "doc_type" | "status" | "audience" | "client_id";

export default function BulkActionBar({ selectedIds, clients, onClear, onApplied }: BulkActionBarProps) {
  const [field, setField] = useState<Field>("status");
  const [value, setValue] = useState<string>("active");
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function apply(patch: Record<string, string | null>) {
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/docs/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ? JSON.stringify(data.error) : "Bulk update failed");
        return;
      }
      setMessage(`Updated ${data.updated} document${data.updated === 1 ? "" : "s"}`);
      onApplied();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage("Network error applying bulk update");
    } finally {
      setApplying(false);
    }
  }

  const fieldOptions: Record<Field, string[]> = {
    doc_type: DOC_TYPES,
    status: DOC_STATUSES,
    audience: DOC_AUDIENCES,
    client_id: ["", ...clients.map((c) => c.id)],
  };
  const labelFor = (f: Field, v: string) =>
    f === "doc_type" ? docTypeLabel(v) :
    f === "status" ? docStatusLabel(v) :
    f === "audience" ? docAudienceLabel(v) :
    v === "" ? "Rosably (unassigned)" : clients.find((c) => c.id === v)?.name ?? v;

  function handleFieldChange(next: Field) {
    setField(next);
    setValue(fieldOptions[next][0] ?? "");
  }

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-brand-black text-white px-4 py-2.5 rounded-lg mb-3 flex-wrap">
      <span className="text-xs font-medium">{selectedIds.length} selected</span>

      <select value={field} onChange={(e) => handleFieldChange(e.target.value as Field)}
        className="text-xs bg-white text-brand-black rounded px-2 py-1">
        <option value="status">Status</option>
        <option value="doc_type">Doc type</option>
        <option value="audience">Audience</option>
        <option value="client_id">Client (future)</option>
      </select>

      <select value={value} onChange={(e) => setValue(e.target.value)}
        className="text-xs bg-white text-brand-black rounded px-2 py-1">
        {fieldOptions[field].map((v) => <option key={v || "unassigned"} value={v}>{labelFor(field, v)}</option>)}
      </select>

      <button
        onClick={() => apply({ [field]: field === "client_id" ? (value || null) : value })}
        disabled={applying}
        className="text-xs font-medium px-3 py-1 rounded bg-brand-orange hover:bg-brand-orange-dark disabled:opacity-50"
      >
        Apply
      </button>

      <button
        onClick={() => apply({ status: "archived" })}
        disabled={applying}
        className="text-xs font-medium px-3 py-1 rounded border border-white/30 hover:bg-white/10 disabled:opacity-50"
      >
        Archive
      </button>

      {message && <span className="text-xs text-white/80">{message}</span>}

      <button onClick={onClear} className={clsx("ml-auto text-xs text-white/70 hover:text-white")}>
        Clear selection
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/app/\(dashboard\)/documents/BulkActionBar.tsx
git commit -m "feat: add BulkActionBar component for doc manager"
```

---

### Task 11: Wire everything into `documents/page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/documents/page.tsx`

**Interfaces:**
- Consumes: `FacetRail`, `KpiRow`, `Filters`, `EMPTY_FILTERS`, `applyFilters`, `ClientOption` (from Task 7's `FacetRail.tsx`); `Reader`, `ReaderDoc` (Task 8); `MetadataDrawer`, `DrawerDoc` (Task 9); `BulkActionBar` (Task 10, now takes a `clients` prop); `DOC_TYPES`, `docTypeLabel`, `docAudienceLabel`, `docStatusLabel`, `DOC_STATUS_COLORS`, `computeHealth`, `DOC_HEALTH_LABELS` from `@/lib/doc-types`; `can` from `@/lib/permissions`; existing `/api/docs/list`, new `/api/docs/clients`.
- Produces: the page itself (terminal node — nothing downstream depends on this file's exports since it's a route page).

This task replaces the file's list/content-viewer body while keeping the header (title, count, Reindex button, Images link) intact. Read the current file at `src/app/(dashboard)/documents/page.tsx` first — you are replacing everything from the `DocEntry` interface through the end of the file. The `useReindex` hook, `FileIcon`, `ChevronIcon`, `slugify`, `extractText`, `makeHeading`, `MD_COMPONENTS` helpers at the top of the file (lines 1–107) are unused by the new page body except `useReindex` — the icon/markdown helpers move into `Reader.tsx` (already duplicated there) and can be deleted from this file since nothing else here renders raw markdown anymore.

- [ ] **Step 1: Replace the top of the file (imports through the `useReindex` hook)**

Replace lines 1–32 (everything from the `"use client"` pragma through the end of `useReindex`) with:

```tsx
"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  docTypeLabel, docAudienceLabel, docStatusLabel,
  DOC_STATUS_COLORS, DocStatus, computeHealth, DOC_HEALTH_LABELS,
} from "@/lib/doc-types";
import { can } from "@/lib/permissions";
import FacetRail, { KpiRow, EMPTY_FILTERS, applyFilters, Filters, ClientOption, FacetDoc } from "./FacetRail";
import Reader, { ReaderDoc } from "./Reader";
import MetadataDrawer, { DrawerDoc } from "./MetadataDrawer";
import BulkActionBar from "./BulkActionBar";

// ── Reindex ───────────────────────────────────────────────────────────────────

function useReindex() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [output, setOutput] = useState<string>("");

  async function run() {
    setState("running");
    setOutput("");
    try {
      const res = await fetch("/api/tools/reindex-docs", { method: "POST" });
      const data = await res.json();
      setOutput(data.output ?? data.error ?? "No output");
      setState(data.ok === false || !res.ok ? "error" : "done");
    } catch (e) {
      setOutput(String(e));
      setState("error");
    }
  }

  return { state, output, run };
}
```

- [ ] **Step 2: Replace everything from `interface DocEntry` to the end of the file**

Find the line `interface DocEntry {` (originally line 34) through the final closing brace of the file, and replace all of it (including `SearchResult`, all utility functions, all icon components, `DocRow`, `DocListPanel`, `SearchResultsPanel`, `TOCPanel`, and both `DocumentsPage`/`DocumentsPageInner`) with:

```tsx
// ── Types ────────────────────────────────────────────────────────────────────

interface DocEntry extends FacetDoc {
  description?: string | null;
  work_item_id?: string | null;
  work_item_title?: string | null;
}

// ── Table ────────────────────────────────────────────────────────────────────

function HealthBadge({ doc }: { doc: DocEntry }) {
  const health = computeHealth(doc);
  if (health === "n/a" || health === "indexed") return null;
  const color = health === "stale" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-red-50 text-red-700 border-red-200";
  return <span className={clsx("text-[10px] px-1.5 py-0.5 rounded border", color)}>{DOC_HEALTH_LABELS[health]}</span>;
}

function DocTable({ docs, selectedIds, onToggleSelect, onToggleSelectAll, onOpenReader, onOpenDrawer, clientNameById, canManage }: {
  docs: DocEntry[];
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onOpenReader: (doc: DocEntry) => void;
  onOpenDrawer: (doc: DocEntry) => void;
  clientNameById: Map<string, string>;
  canManage: boolean;
}) {
  const allSelected = docs.length > 0 && docs.every((d) => selectedIds.has(d.id));

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-brand-border text-left text-[10px] uppercase tracking-wide text-brand-muted">
          {canManage && (
            <th className="w-8 px-2 py-2">
              <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
            </th>
          )}
          <th className="px-2 py-2">Document</th>
          <th className="px-2 py-2">Type</th>
          <th className="px-2 py-2">Audience</th>
          <th className="px-2 py-2">Status</th>
          <th className="px-2 py-2">Client</th>
          <th className="px-2 py-2">Chunks</th>
          <th className="px-2 py-2">Last indexed</th>
          <th className="px-2 py-2">Updated</th>
        </tr>
      </thead>
      <tbody>
        {docs.map((doc) => {
          const statusColor = DOC_STATUS_COLORS[doc.status as DocStatus] ?? "bg-gray-100 text-gray-600 border-gray-200";
          const clientName = doc.client_id ? clientNameById.get(doc.client_id) ?? "Unknown client" : "Rosably";
          return (
            <tr key={doc.id} className="border-b border-brand-border/50 hover:bg-brand-offwhite transition-colors">
              {canManage && (
                <td className="px-2 py-2">
                  <input type="checkbox" checked={selectedIds.has(doc.id)} onChange={() => onToggleSelect(doc.id)} />
                </td>
              )}
              <td className="px-2 py-2 min-w-0">
                <button onClick={() => onOpenReader(doc)} className="text-left block truncate max-w-[280px]">
                  <span className="text-sm text-brand-black font-medium hover:text-brand-orange">{doc.name}</span>
                </button>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] text-brand-muted font-mono truncate max-w-[240px]">{doc.path}</p>
                  {canManage && (
                    <button onClick={() => onOpenDrawer(doc)} title="Edit metadata" className="text-brand-muted hover:text-brand-orange flex-shrink-0">
                      ✎
                    </button>
                  )}
                  <HealthBadge doc={doc} />
                </div>
              </td>
              <td className="px-2 py-2 text-xs text-brand-black whitespace-nowrap">{docTypeLabel(doc.doc_type)}</td>
              <td className="px-2 py-2 text-xs text-brand-black whitespace-nowrap">{docAudienceLabel(doc.audience)}</td>
              <td className="px-2 py-2">
                <span className={clsx("text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap", statusColor)}>
                  {docStatusLabel(doc.status)}
                </span>
              </td>
              <td className="px-2 py-2 text-xs text-brand-muted whitespace-nowrap">{clientName}</td>
              <td className="px-2 py-2 text-xs text-brand-muted">{doc.chunk_count ?? "—"}</td>
              <td className="px-2 py-2 text-xs text-brand-muted whitespace-nowrap">
                {doc.last_indexed_at ? formatDistanceToNow(parseISO(doc.last_indexed_at), { addSuffix: true }) : "never"}
              </td>
              <td className="px-2 py-2 text-xs text-brand-muted whitespace-nowrap">
                {doc.updated_at ? formatDistanceToNow(parseISO(doc.updated_at), { addSuffix: true }) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function GroupedDocTable(props: Parameters<typeof DocTable>[0]) {
  const groups = useMemo(() => {
    const map = new Map<string, DocEntry[]>();
    for (const d of props.docs) {
      if (!map.has(d.doc_type)) map.set(d.doc_type, []);
      map.get(d.doc_type)!.push(d);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [props.docs]);

  return (
    <div className="space-y-6">
      {groups.map(([type, docs]) => (
        <div key={type}>
          <p className="text-xs font-semibold text-brand-black mb-1">{docTypeLabel(type)} <span className="text-brand-muted font-normal">({docs.length})</span></p>
          <DocTable {...props} docs={docs} />
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-8" />}>
      <DocumentsPageInner />
    </Suspense>
  );
}

function DocumentsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reindex = useReindex();

  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [filters, setFilters] = useState<Filters>({
    status: searchParams.get("status") ?? "",
    doc_type: searchParams.get("doc_type") ?? "",
    audience: searchParams.get("audience") ?? "",
    client: searchParams.get("client") ?? "",
    health: searchParams.get("health") ?? "",
  });
  const [grouped, setGrouped] = useState(searchParams.get("view") === "grouped");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [readerDoc, setReaderDoc] = useState<DocEntry | null>(null);
  const [readerMode, setReaderMode] = useState<"fullscreen" | "panel">("fullscreen");
  const [drawerDoc, setDrawerDoc] = useState<DocEntry | null>(null);

  const canManage = can(permissions, "manage_documents");

  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (data?.permissions) setPermissions(data.permissions);
    }).catch(() => {});
  }, []);

  const loadDocs = useCallback(() => {
    setListLoading(true);
    fetch("/api/docs/list").then((r) => r.json()).then((data) => {
      if (data.error) setListError(data.error);
      else setDocs(Array.isArray(data) ? data : []);
      setListLoading(false);
    }).catch(() => {
      setListError("Could not load document registry");
      setListLoading(false);
    });
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  useEffect(() => {
    fetch("/api/docs/clients").then((r) => r.json()).then((data) => setClients(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  // Reflect filters + q in the URL so views are shareable/bookmarkable.
  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filters.status) params.set("status", filters.status);
    if (filters.doc_type) params.set("doc_type", filters.doc_type);
    if (filters.audience) params.set("audience", filters.audience);
    if (filters.client) params.set("client", filters.client);
    if (filters.health) params.set("health", filters.health);
    if (grouped) params.set("view", "grouped");
    router.replace(`/documents${params.toString() ? `?${params}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filters, grouped]);

  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const filteredDocs = useMemo(() => applyFilters(docs, filters, q), [docs, filters, q]);

  function handleFilterChange(patch: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (filteredDocs.every((d) => prev.has(d.id))) return new Set();
      return new Set(filteredDocs.map((d) => d.id));
    });
  }

  function drawerDocFromEntry(doc: DocEntry): DrawerDoc {
    return {
      id: doc.id, name: doc.name, path: doc.path, doc_type: doc.doc_type, status: doc.status,
      audience: doc.audience, client_id: doc.client_id, description: doc.description ?? null,
      chunk_count: doc.chunk_count ?? null, last_indexed_at: doc.last_indexed_at ?? null,
      updated_at: doc.updated_at, storage_path: doc.storage_path ?? null,
    };
  }

  function readerDocFromEntry(doc: DocEntry): ReaderDoc {
    return { id: doc.id, name: doc.name, path: doc.path, doc_type: doc.doc_type, status: doc.status, audience: doc.audience };
  }

  return (
    <div className="p-4 md:p-8 pt-16 md:pt-8 pb-24 md:pb-8">
      <div className="mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-brand-black">Documents</h1>
            <p className="text-sm text-brand-muted mt-0.5">
              {listLoading ? "Loading…" : listError ? "Failed to load document registry" : `${docs.length} document${docs.length !== 1 ? "s" : ""} available`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setGrouped((g) => !g)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-brand-border bg-white text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
              {grouped ? "Flat view" : "Group by type"}
            </button>
            <Link href="/images"
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-brand-border bg-white text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors inline-flex items-center gap-1.5">
              Images
            </Link>
            <button onClick={reindex.run} disabled={reindex.state === "running"} title="Sync doc_chunks with current markdown files"
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                reindex.state === "running" ? "bg-brand-offwhite text-brand-muted border-brand-border cursor-not-allowed" :
                reindex.state === "done" ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100" :
                reindex.state === "error" ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" :
                "bg-white text-brand-muted border-brand-border hover:bg-brand-offwhite hover:text-brand-black"
              )}>
              {reindex.state === "running" ? "Indexing…" : reindex.state === "done" ? "Indexed ✓" : reindex.state === "error" ? "Failed ✗" : "Reindex docs"}
            </button>
          </div>
        </div>
        {reindex.output && (
          <pre className="mt-3 text-xs bg-brand-offwhite rounded-lg px-3 py-2.5 overflow-auto max-h-32 whitespace-pre-wrap text-brand-muted border border-brand-border">
            {reindex.output}
          </pre>
        )}
      </div>

      <KpiRow docs={docs} filters={filters} q={q} onChange={handleFilterChange} />

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or path…"
        className="text-sm border border-brand-border rounded-lg px-3 py-2 mb-4 w-full max-w-sm focus:outline-none focus:border-brand-orange"
      />

      <div className="flex gap-4">
        <FacetRail docs={docs} clients={clients} filters={filters} q={q} onChange={handleFilterChange} />

        <div className="flex-1 min-w-0">
          {canManage && selectedIds.size > 0 && (
            <BulkActionBar
              selectedIds={Array.from(selectedIds)}
              clients={clients}
              onClear={() => setSelectedIds(new Set())}
              onApplied={() => { loadDocs(); setSelectedIds(new Set()); }}
            />
          )}

          <div className="card overflow-x-auto">
            {listLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4].map((i) => <div key={i} className="animate-pulse h-8 bg-brand-offwhite rounded" />)}
              </div>
            ) : listError ? (
              <div className="p-6 text-center"><p className="text-xs text-red-600 font-medium">{listError}</p></div>
            ) : filteredDocs.length === 0 ? (
              <div className="p-6 text-center"><p className="text-xs text-brand-muted">No documents found</p></div>
            ) : grouped ? (
              <GroupedDocTable
                docs={filteredDocs} selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll}
                onOpenReader={(d) => { setReaderDoc(d); setReaderMode("fullscreen"); }}
                onOpenDrawer={setDrawerDoc} clientNameById={clientNameById} canManage={canManage}
              />
            ) : (
              <DocTable
                docs={filteredDocs} selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll}
                onOpenReader={(d) => { setReaderDoc(d); setReaderMode("fullscreen"); }}
                onOpenDrawer={setDrawerDoc} clientNameById={clientNameById} canManage={canManage}
              />
            )}
          </div>
        </div>
      </div>

      {readerDoc && readerMode === "panel" && (
        <div className="fixed inset-y-0 right-0 z-40 flex" style={{ top: 0 }}>
          <Reader
            doc={readerDocFromEntry(readerDoc)}
            mode="panel"
            onClose={() => setReaderDoc(null)}
            onToggleMode={() => setReaderMode("fullscreen")}
            onEditMetadata={() => setDrawerDoc(readerDoc)}
          />
        </div>
      )}
      {readerDoc && readerMode === "fullscreen" && (
        <Reader
          doc={readerDocFromEntry(readerDoc)}
          mode="fullscreen"
          onClose={() => setReaderDoc(null)}
          onToggleMode={() => setReaderMode("panel")}
          onEditMetadata={() => setDrawerDoc(readerDoc)}
        />
      )}

      {drawerDoc && (
        <div className="fixed inset-y-0 right-0 z-50 flex">
          <MetadataDrawer
            doc={drawerDocFromEntry(drawerDoc)}
            clients={clients}
            onClose={() => setDrawerDoc(null)}
            onSaved={() => { loadDocs(); setDrawerDoc(null); }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0. Fix any type mismatches between `FacetDoc`, `DocEntry`, `DrawerDoc`, and `ReaderDoc` field names if the compiler flags them — all four are intentionally structurally compatible subsets of the same `doc_registry` row shape.

- [ ] **Step 4: Manual browser verification (dev server) — SKIPPED per the Global Constraints note on the stale `SUPABASE_SERVICE_ROLE_KEY`; do a code-reasoning pass instead**

Live verification of this task is the biggest loss from the stale-key issue — this is the integration task where all the components come together, and it cannot be click-tested right now. Do not skip this step silently: in place of the 12 browser checks below, read through `page.tsx`'s state wiring line by line and trace each of the 12 scenarios by hand against the actual code (not the plan's description of it), writing out in your report, for each of the 12: which state variables change, which child component re-renders with which props, and whether the result matches the expected behavior. Flag anything you can't fully convince yourself of as a concern rather than asserting it works. This report will be the only evidence available for this task's review until the key is fixed and someone runs the checklist for real — treat it accordingly.

The 12 scenarios and the original live-browser instructions are preserved below as reference for whenever the key is fixed and someone (implementer or Brian) can run them for real:

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npm run dev` and open `http://localhost:3000/documents` in a browser, logged in as an admin user.

Check each of these and confirm the observed behavior matches:
1. Page loads, KPI cards show correct Total/Active/Drafts/Archived/Index-issues counts (cross-check Total against the count already known live: 79).
2. Clicking a KPI card (e.g. "Active") filters the table to only `active` docs and highlights the card; clicking it again clears the filter.
3. Facet rail counts update live as other filters are applied (e.g. selecting a `doc_type` narrows the Status facet's counts to just that type).
4. Typing in the search box filters the table to docs whose name or path contains the text (case-insensitive); the URL updates with `?q=...`.
5. "Group by type" toggles the table into section-headers-with-counts mode and back; the URL gains `?view=grouped` while active and it's gone when toggled off; reloading the page with `?view=grouped` in the URL starts in grouped mode.
6. Clicking a document row opens the full-screen Reader, rendering its markdown centered in a ~900px column; the header shows name/path/type/status/audience badges.
7. In the Reader, click "Collapse to panel" — it becomes a right-docked ~45%-width panel instead of full-screen; click "Expand" to return to full-screen; press Esc while full-screen to close.
8. Pick any doc known to have `content IS NULL` (query `select path from doc_registry where content is null and storage_path is null limit 1` via the Supabase MCP `execute_sql` tool against project `ukfpmpxwdlpsjqbxreza` to find one) and open it — confirm the "No indexed content yet." empty state renders instead of a blank pane or crash.
9. Click the ✎ icon on a row (or "Edit metadata" inside the Reader) — the MetadataDrawer opens on the right; change the `status` dropdown and click "Save changes" — confirm the table row's status badge updates after the drawer closes and the doc's `updated_at` changes (spot-check with `execute_sql`: `select status, updated_at from doc_registry where id = <that id>`). Change it back afterward to avoid leaving test data mutated.
10. Select 2+ rows via checkboxes — the BulkActionBar appears sticky above the table with the correct count; apply a bulk `audience` change and confirm the toast-style inline message shows "Updated N documents" and the rows update. Also switch the bar's field dropdown to "Client (future)" and confirm it lists "Rosably (unassigned)" plus any `crm.clients` rows (empty today, so just the unassigned option), and applying it patches `client_id`. Revert afterward.
11. Log out (or open a private/incognito window and log in as a `viewer`-role user if one exists) and reload `/documents` — confirm checkboxes, the ✎ edit icon, and the BulkActionBar are all absent (view-only), while the KPI cards, facets, search, group-by, and Reader still work.
12. Confirm the "Reindex docs" button still works exactly as before (unchanged from the pre-existing implementation).

Stop the dev server after checking.

- [ ] **Step 5: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add "src/app/(dashboard)/documents/page.tsx"
git commit -m "feat: rebuild documents page with facets, KPIs, full-screen reader, and metadata editing"
```

---

## Post-implementation notes for the PR description

- No migration included (per Global Constraints) — the §7-equivalent taxonomy-tightening migration remains a separate, explicitly-approved follow-up.
- `doc_chunks` RLS-disabled gap is unchanged — still flagged as a separate remediation decision, not touched here.
- Test plan for the PR body should restate the 12 manual-verification checks from Task 11, Step 4, plus "`npx tsc --noEmit` passes" from every task. Note in the PR description that `npm run lint` is broken repo-wide on Next.js 16 (pre-existing, unrelated to this change) and was therefore not run.
