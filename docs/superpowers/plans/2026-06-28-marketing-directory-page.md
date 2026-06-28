# Marketing Directory & Advertising Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/marketing` dashboard page under the Sales & Marketing section that manages directory listing submissions via a live Supabase table, with inline status editing, manual add, Avery-powered research, and a placeholder Advertising tab.

**Architecture:** A new `directories` Supabase table is the single source of truth (replacing the markdown tracker). The dashboard page has two tabs — Directories (full CRUD + Avery research) and Advertising (placeholder). Avery gets a new `/research-directories` endpoint that accepts a POST, runs a Tavily web search for new listing opportunities, and returns structured candidates that land as `is_candidate=true` rows for Brian to approve or dismiss.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (supabaseAdmin service role), existing `clsx` + `date-fns` libs already in the project.

## Global Constraints

- Node pinned to `20.x` — do not bump.
- No test runner — verify via `npm run build` (must pass with 0 errors) and manual dev-server smoke test.
- `supabaseAdmin` is server-only — never import in `"use client"` components.
- Traefik certresolver is `mytlschallenge` (not `letsencrypt`) — irrelevant here but noted.
- Nav icons must use the existing `Icon` component from `nav-config.tsx` — no new icon lib.
- Supabase schema changes require Brian approval before applying the migration.
- All API routes follow the pattern: `import { supabaseAdmin } from "@/lib/supabase-admin"`, return `NextResponse.json`.
- Commits use conventional format: `feat:`, `fix:`, `chore:`.
- Default branch is `main`; push there directly.

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/app/(dashboard)/marketing/page.tsx` | Marketing page — tab shell (Directories \| Advertising) |
| `src/app/(dashboard)/marketing/DirectoriesTab.tsx` | Full directories data table with inline editing, filters, add button, research button |
| `src/app/(dashboard)/marketing/AddDirectoryModal.tsx` | Form modal for manual directory entry |
| `src/app/(dashboard)/marketing/AdvertisingTab.tsx` | Placeholder Advertising tab |
| `src/app/api/marketing/directories/route.ts` | GET (list) + POST (create) |
| `src/app/api/marketing/directories/[id]/route.ts` | PATCH (update) + DELETE |
| `src/app/api/marketing/directories/research/route.ts` | POST — triggers Avery research endpoint |

### Modified files
| File | Change |
|------|--------|
| `src/components/nav-config.tsx` | Add `/marketing` to `sales.active`; add Marketing sub-page under `SUB_PAGES.sales` |

### Migration (applied out-of-band, not a repo file)
SQL applied via Supabase Management API — included verbatim in Task 1.

---

## Task 1: Database — `directories` table + seed data

**Prerequisite:** Brian must approve and apply this migration before Tasks 2–5 can be tested end-to-end. Share the SQL below with Brian.

**Files:**
- No repo file — SQL applied via Supabase Management API or Supabase dashboard SQL editor.

**Interfaces:**
- Produces: `directories` table with columns consumed by all subsequent API routes.

- [ ] **Step 1: Prepare and share migration SQL**

```sql
-- Migration: directories table
-- Applied: 2026-06-28

CREATE TABLE public.directories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  priority_tier TEXT NOT NULL DEFAULT 'Submit Soon',   -- 'Submit Now' | 'Submit Soon' | 'Low Priority'
  cost          TEXT,
  complexity    TEXT,                                   -- 'Easy' | 'Moderate' | 'Complex'
  status        TEXT NOT NULL DEFAULT 'Not Started',   -- 'Not Started' | 'In Progress' | 'Submitted' | 'Live' | 'Skipped'
  date_completed DATE,
  notes         TEXT,
  is_candidate  BOOLEAN NOT NULL DEFAULT FALSE,        -- TRUE = Avery suggestion awaiting Brian's review
  source        TEXT NOT NULL DEFAULT 'manual',        -- 'manual' | 'avery_research'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.directories ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; no additional policies needed for dashboard use.
-- Add an authenticated-read policy when/if public access is ever needed.

-- Seed: current tracker data (25 rows, statuses as of 2026-06-28)
INSERT INTO public.directories (name, url, priority_tier, cost, complexity, status, date_completed, notes) VALUES
  ('Google Business Profile',  'business.google.com',              'Submit Now',    'Free',              'Easy',     'Live',        '2026-06-15', '#1 priority — verify via postcard/phone, 1–2 wks'),
  ('TechSoup Marketplace',     'techsoup.org/marketplace',         'Submit Now',    'Free to apply',     'Complex',  'In Progress',  NULL,         'Long lead time — start application ASAP. Consultants Connection ($395/yr) skipped for now.'),
  ('Clutch',                   'clutch.co',                        'Submit Now',    'Free basic',        'Moderate', 'Submitted',   '2026-06-28', 'Need client reviews to rank meaningfully'),
  ('UpCity',                   'upcity.com',                       'Submit Now',    'Free basic',        'Easy',     'Skipped',     '2026-06-28', 'Site shut down — no longer available'),
  ('Expertise.com',            'expertise.com',                    'Submit Now',    'Free',              'Easy',     'Skipped',     '2026-06-28', 'Not relevant for our business type'),
  ('NTEN Partner Directory',   'nten.org/partners',                'Submit Now',    '~$500/yr',          'Moderate', 'Not Started',  NULL,         'Credibility signal to nonprofit tech buyers'),
  ('Alignable',                'alignable.com',                    'Submit Now',    'Free basic',        'Easy',     'Live',        '2026-06-28', 'Underrated B2B referral network'),
  ('Bing Places',              'bingplaces.com',                   'Submit Now',    'Free',              'Easy',     'Live',        '2026-06-28', 'Imported from Google Business Profile, ~10 min'),
  ('GoodFirms',                'goodfirms.co',                     'Submit Soon',   'Free basic',        'Easy',     'Live',        '2026-06-28', '~20-min task, low friction'),
  ('The Manifest',             'themanifest.com',                  'Submit Soon',   'Free (via Clutch)', 'Easy',     'Not Started',  NULL,         'Auto-populated once listed on Clutch'),
  ('Nonprofit Tech for Good',  'nptechforgood.com',                'Submit Soon',   'Free',              'Easy',     'Not Started',  NULL,         'Strong organic nonprofit tech following'),
  ('Cleveland Chamber (GCP)',  'clevelandchamber.com',             'Submit Soon',   '~$400–600/yr',      'Moderate', 'Not Started',  NULL,         'Credibility + networking, not just directory'),
  ('Cleveland.com Directory',  'cleveland.com/business-directory', 'Submit Soon',   'Free basic',        'Easy',     'Not Started',  NULL,         'Strong domain authority for local SEO'),
  ('Crain''s Cleveland',       'crainscleveland.com',              'Submit Soon',   'Paid',              'Moderate', 'Not Started',  NULL,         'C-suite audience; also worth editorial pitch'),
  ('Team NEO',                 'teamneo.org',                      'Submit Soon',   'Free',              'Easy',     'Not Started',  NULL,         'NEO presence credibility signal'),
  ('G2',                       'g2.com',                           'Low Priority',  'Free basic',        'Moderate', 'Not Started',  NULL,         'Better for software; Clutch is stronger fit'),
  ('Sortlist',                 'sortlist.com',                     'Low Priority',  'Free basic',        'Easy',     'Not Started',  NULL,         'European-heavy, low near-term ROI'),
  ('FoundationList',           'foundationlist.org',               'Low Priority',  'Free basic',        'Easy',     'Not Started',  NULL,         'Grants audience, not tech buyers'),
  ('Idealist',                 'idealist.org',                     'Low Priority',  'Free',              'Easy',     'Not Started',  NULL,         'Job listings only — skip unless hiring'),
  ('NonprofitReady',           'nonprofitready.org',               'Low Priority',  'Partner/sponsor',   'Moderate', 'Not Started',  NULL,         'Training-focused; better for content placement'),
  ('npENGAGE / Blackbaud',     'community.blackbaud.com',          'Low Priority',  'Enterprise',        'Complex',  'Not Started',  NULL,         'Enterprise partnership — revisit when larger'),
  ('Yelp',                     'biz.yelp.com',                     'Low Priority',  'Free basic',        'Easy',     'Not Started',  NULL,         'NAP consistency only; don''t invest time'),
  ('Ohio Chamber',             'ohiochamber.com',                  'Low Priority',  'Membership',        'Moderate', 'Not Started',  NULL,         'Do Cleveland chamber first'),
  ('Ohio.org',                 'ohio.org',                         'Low Priority',  'Free',              'Easy',     'Not Started',  NULL,         'Compliance/registration, not lead gen'),
  ('BizJournals Ohio',         'bizjournals.com/columbus',         'Low Priority',  'Paid',              'Moderate', 'Not Started',  NULL,         'Good brand exposure — revisit with budget');
```

- [ ] **Step 2: Brian applies the migration**

Apply via Supabase SQL editor or Management API. Confirm rows exist:
```bash
curl -s "https://ukfpmpxwdlpsjqbxreza.supabase.co/rest/v1/directories?select=count&head=true" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact" -I | grep content-range
# Expected: content-range: 0-24/25
```

- [ ] **Step 3: Commit a note** (no code change — task is database-only)

```bash
git commit --allow-empty -m "chore: directories table migration applied (25 rows seeded)"
```

---

## Task 2: API routes — CRUD for `directories`

**Files:**
- Create: `src/app/api/marketing/directories/route.ts`
- Create: `src/app/api/marketing/directories/[id]/route.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/supabase-admin`, `directories` table from Task 1.
- Produces:
  - `GET /api/marketing/directories` → `Directory[]`
  - `POST /api/marketing/directories` → created `Directory`
  - `PATCH /api/marketing/directories/[id]` → updated `Directory`
  - `DELETE /api/marketing/directories/[id]` → `{ ok: true }`

```typescript
// Shape returned by all routes — matches DB columns exactly
interface Directory {
  id: string;
  name: string;
  url: string;
  priority_tier: string;
  cost: string | null;
  complexity: string | null;
  status: string;
  date_completed: string | null;   // ISO date string "YYYY-MM-DD"
  notes: string | null;
  is_candidate: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 1: Create `src/app/api/marketing/directories/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ALLOWED_CREATE = new Set([
  "name", "url", "priority_tier", "cost", "complexity",
  "status", "date_completed", "notes", "is_candidate", "source",
]);

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("directories")
    .select("*")
    .order("priority_tier", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const insert: Record<string, unknown> = {};
  for (const key of ALLOWED_CREATE) {
    if (key in body) insert[key] = body[key];
  }
  if (!insert.name || !insert.url) {
    return NextResponse.json({ error: "name and url are required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("directories")
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
```

- [ ] **Step 2: Create `src/app/api/marketing/directories/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ALLOWED_PATCH = new Set([
  "name", "url", "priority_tier", "cost", "complexity",
  "status", "date_completed", "notes", "is_candidate",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await req.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ALLOWED_PATCH) {
    if (key in body) updates[key] = body[key];
  }

  const { data, error } = await supabaseAdmin
    .from("directories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin
    .from("directories")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Build check**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard && npm run build 2>&1 | grep -E "error|Error|✓ Compiled"
# Expected: "✓ Compiled" with no TypeScript errors
```

- [ ] **Step 4: Smoke test the API (requires migration from Task 1)**

```bash
# Should return 25 directories
curl -s http://localhost:3000/api/marketing/directories | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), 'rows')"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/marketing/
git commit -m "feat: directories CRUD API routes (GET/POST/PATCH/DELETE)"
```

---

## Task 3: Nav — add Marketing sub-page to Sales & Marketing

**Files:**
- Modify: `src/components/nav-config.tsx`

**Interfaces:**
- Produces: `/marketing` is a valid nav destination under `sales`; the Sidebar highlights it correctly when at `/marketing`.

- [ ] **Step 1: Add `/marketing` to `sales.active` and `SUB_PAGES.sales`**

In `src/components/nav-config.tsx`, make these two changes:

**Change 1** — add `"/marketing"` to the `sales` module's `active` array:
```typescript
// Before:
  active: ["/sales", "/crm", "/quiz", "/content", "/analytics"],

// After:
  active: ["/sales", "/crm", "/quiz", "/content", "/analytics", "/marketing"],
```

**Change 2** — add Marketing entry to `SUB_PAGES.sales`:
```typescript
// Before:
  sales: [
    { label: "Sales",     href: "/sales",     icon: "trendingUp" },
    { label: "CRM",       href: "/crm",       icon: "users"      },
    { label: "Content",   href: "/content",   icon: "edit"       },
    { label: "Analytics", href: "/analytics", icon: "barChart"   },
    { label: "Quiz",      href: "/quiz",       icon: "package"   },
  ],

// After:
  sales: [
    { label: "Sales",      href: "/sales",      icon: "trendingUp" },
    { label: "CRM",        href: "/crm",        icon: "users"      },
    { label: "Content",    href: "/content",    icon: "edit"       },
    { label: "Analytics",  href: "/analytics",  icon: "barChart"   },
    { label: "Quiz",       href: "/quiz",        icon: "package"   },
    { label: "Marketing",  href: "/marketing",  icon: "trendingUp" },
  ],
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | grep -E "error|Error|✓ Compiled"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/nav-config.tsx
git commit -m "feat: add Marketing sub-page to Sales & Marketing nav"
```

---

## Task 4: UI — Marketing page shell + Directories tab

**Files:**
- Create: `src/app/(dashboard)/marketing/page.tsx`
- Create: `src/app/(dashboard)/marketing/DirectoriesTab.tsx`
- Create: `src/app/(dashboard)/marketing/AddDirectoryModal.tsx`
- Create: `src/app/(dashboard)/marketing/AdvertisingTab.tsx`

**Interfaces:**
- Consumes: `GET /api/marketing/directories`, `POST /api/marketing/directories`, `PATCH /api/marketing/directories/[id]`, `DELETE /api/marketing/directories/[id]` from Task 2.
- Produces: Rendered page at `/marketing` with working inline status editing, add modal, and advertising placeholder.

```typescript
// Directory type used across all UI files in this task
interface Directory {
  id: string;
  name: string;
  url: string;
  priority_tier: string;
  cost: string | null;
  complexity: string | null;
  status: string;
  date_completed: string | null;
  notes: string | null;
  is_candidate: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 1: Create `src/app/(dashboard)/marketing/AdvertisingTab.tsx`**

```typescript
"use client";

export default function AdvertisingTab() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 bg-brand-offwhite rounded-2xl flex items-center justify-center mb-5">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
          <polyline points="17 6 23 6 23 12"/>
        </svg>
      </div>
      <p className="text-sm font-medium text-brand-black mb-1">Advertising Management</p>
      <p className="text-xs text-brand-muted max-w-xs">
        Track paid advertising channels — Google Ads, LinkedIn, and more. Coming soon.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(dashboard)/marketing/AddDirectoryModal.tsx`**

```typescript
"use client";
import { useState } from "react";
import clsx from "clsx";

const PRIORITY_OPTIONS = ["Submit Now", "Submit Soon", "Low Priority"];
const COMPLEXITY_OPTIONS = ["Easy", "Moderate", "Complex"];
const STATUS_OPTIONS = ["Not Started", "In Progress", "Submitted", "Live", "Skipped"];

interface Props {
  onClose: () => void;
  onCreated: (dir: Record<string, unknown>) => void;
}

export default function AddDirectoryModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    name: "", url: "", priority_tier: "Submit Soon",
    cost: "", complexity: "Easy", status: "Not Started",
    date_completed: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          date_completed: form.date_completed || null,
          cost: form.cost || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to create"); return; }
      onCreated(data);
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-black">Add Directory</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-brand-muted mb-1">Directory Name *</label>
              <input required value={form.name} onChange={e => set("name", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-brand-muted mb-1">URL *</label>
              <input required value={form.url} onChange={e => set("url", e.target.value)}
                placeholder="example.com"
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Priority</label>
              <select value={form.priority_tier} onChange={e => set("priority_tier", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange">
                {PRIORITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange">
                {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Cost</label>
              <input value={form.cost} onChange={e => set("cost", e.target.value)}
                placeholder="Free"
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Complexity</label>
              <select value={form.complexity} onChange={e => set("complexity", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange">
                {COMPLEXITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Date Completed</label>
              <input type="date" value={form.date_completed} onChange={e => set("date_completed", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-brand-muted mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
                rows={2}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange resize-none" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-brand-border text-brand-muted hover:bg-brand-offwhite transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className={clsx("px-4 py-2 text-sm rounded-lg font-medium transition-colors",
                saving ? "bg-brand-offwhite text-brand-muted cursor-not-allowed"
                        : "bg-brand-orange text-white hover:bg-brand-orange/90")}>
              {saving ? "Saving…" : "Add Directory"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(dashboard)/marketing/DirectoriesTab.tsx`**

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import AddDirectoryModal from "./AddDirectoryModal";

interface Directory {
  id: string; name: string; url: string; priority_tier: string;
  cost: string | null; complexity: string | null; status: string;
  date_completed: string | null; notes: string | null;
  is_candidate: boolean; source: string;
}

const STATUS_OPTIONS = ["Not Started", "In Progress", "Submitted", "Live", "Skipped"];
const PRIORITY_FILTERS = ["All", "Submit Now", "Submit Soon", "Low Priority"];
const STATUS_FILTERS = ["All", "Not Started", "In Progress", "Submitted", "Live", "Skipped"];

const STATUS_COLORS: Record<string, string> = {
  "Live":        "bg-green-100 text-green-700",
  "Submitted":   "bg-blue-100 text-blue-700",
  "In Progress": "bg-amber-100 text-amber-700",
  "Skipped":     "bg-gray-100 text-gray-500",
  "Not Started": "bg-brand-offwhite text-brand-muted",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium",
      STATUS_COLORS[status] ?? "bg-brand-offwhite text-brand-muted")}>
      {status}
    </span>
  );
}

function DirectoryRow({ dir, onUpdate, onDelete }: {
  dir: Directory;
  onUpdate: (id: string, patch: Partial<Directory>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(dir.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function patchStatus(status: string) {
    setSaving(true);
    const date_completed = ["Live", "Submitted", "Skipped"].includes(status)
      ? (dir.date_completed ?? new Date().toISOString().slice(0, 10))
      : dir.date_completed;
    await onUpdate(dir.id, { status, date_completed });
    setSaving(false);
    setEditingStatus(false);
  }

  async function saveNotes() {
    setSaving(true);
    await onUpdate(dir.id, { notes });
    setSaving(false);
    setEditingNotes(false);
  }

  async function approveCandidate() {
    setSaving(true);
    await onUpdate(dir.id, { is_candidate: false });
    setSaving(false);
  }

  return (
    <tr className={clsx(
      "border-b border-brand-border/50 hover:bg-brand-offwhite/50 transition-colors",
      dir.is_candidate && "bg-brand-orange/5 border-l-2 border-l-brand-orange"
    )}>
      {/* Name + URL */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-brand-black">{dir.name}</span>
          <a href={`https://${dir.url}`} target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-brand-orange hover:underline"
            onClick={e => e.stopPropagation()}>
            {dir.url} ↗
          </a>
          {dir.is_candidate && (
            <span className="text-[10px] text-brand-orange font-medium">Avery suggestion — pending review</span>
          )}
        </div>
      </td>
      {/* Priority */}
      <td className="px-3 py-2.5 text-xs text-brand-muted whitespace-nowrap">{dir.priority_tier}</td>
      {/* Cost */}
      <td className="px-3 py-2.5 text-xs text-brand-muted">{dir.cost ?? "—"}</td>
      {/* Complexity */}
      <td className="px-3 py-2.5 text-xs text-brand-muted">{dir.complexity ?? "—"}</td>
      {/* Status — inline dropdown */}
      <td className="px-3 py-2.5">
        {editingStatus ? (
          <select
            autoFocus
            defaultValue={dir.status}
            disabled={saving}
            onChange={e => patchStatus(e.target.value)}
            onBlur={() => setEditingStatus(false)}
            className="text-xs border border-brand-orange rounded px-1.5 py-1 focus:outline-none"
          >
            {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
          </select>
        ) : (
          <button onClick={() => setEditingStatus(true)} title="Click to change status">
            <StatusBadge status={dir.status} />
          </button>
        )}
      </td>
      {/* Date */}
      <td className="px-3 py-2.5 text-xs text-brand-muted whitespace-nowrap">
        {dir.date_completed
          ? new Date(dir.date_completed + "T00:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" })
          : "—"}
      </td>
      {/* Notes — inline edit */}
      <td className="px-3 py-2.5 text-xs text-brand-muted max-w-[220px]">
        {editingNotes ? (
          <div className="flex gap-1">
            <textarea
              autoFocus
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="text-xs border border-brand-orange rounded px-1.5 py-1 w-full resize-none focus:outline-none"
            />
            <div className="flex flex-col gap-1">
              <button onClick={saveNotes} disabled={saving}
                className="text-[10px] text-green-700 hover:text-green-900 font-medium">Save</button>
              <button onClick={() => { setNotes(dir.notes ?? ""); setEditingNotes(false); }}
                className="text-[10px] text-brand-muted hover:text-brand-black">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditingNotes(true)} title="Click to edit notes"
            className="text-left truncate max-w-[200px] hover:text-brand-black transition-colors">
            {dir.notes || <span className="italic text-brand-muted/50">add note</span>}
          </button>
        )}
      </td>
      {/* Actions */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {dir.is_candidate && (
            <button onClick={approveCandidate} disabled={saving}
              className="text-[11px] px-2 py-0.5 rounded bg-brand-orange/10 text-brand-orange hover:bg-brand-orange/20 font-medium transition-colors">
              Approve
            </button>
          )}
          <button
            onClick={() => onDelete(dir.id)}
            className="text-[11px] text-brand-muted hover:text-red-600 transition-colors"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function DirectoriesTab() {
  const [dirs, setDirs] = useState<Directory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [researching, setResearching] = useState(false);
  const [researchMsg, setResearchMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/directories");
      const data = await res.json();
      setDirs(Array.isArray(data) ? data : []);
    } catch {
      setError("Failed to load directories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpdate = useCallback(async (id: string, patch: Partial<Directory>) => {
    const res = await fetch(`/api/marketing/directories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = await res.json();
    if (res.ok) setDirs(prev => prev.map(d => d.id === id ? { ...d, ...updated } : d));
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this directory entry?")) return;
    const res = await fetch(`/api/marketing/directories/${id}`, { method: "DELETE" });
    if (res.ok) setDirs(prev => prev.filter(d => d.id !== id));
  }, []);

  async function handleResearch() {
    setResearching(true);
    setResearchMsg(null);
    try {
      const res = await fetch("/api/marketing/directories/research", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResearchMsg(`Avery found ${data.added} new candidate${data.added !== 1 ? "s" : ""}. Check the list for orange rows.`);
        await load();
      } else {
        setResearchMsg(data.error ?? "Research failed");
      }
    } catch {
      setResearchMsg("Network error");
    } finally {
      setResearching(false);
    }
  }

  const filtered = dirs.filter(d => {
    if (priorityFilter !== "All" && d.priority_tier !== priorityFilter) return false;
    if (statusFilter !== "All" && d.status !== statusFilter) return false;
    return true;
  });

  // Summary counts
  const live = dirs.filter(d => d.status === "Live").length;
  const submitted = dirs.filter(d => d.status === "Submitted").length;
  const inProgress = dirs.filter(d => d.status === "In Progress").length;
  const notStarted = dirs.filter(d => d.status === "Not Started").length;
  const candidates = dirs.filter(d => d.is_candidate).length;

  return (
    <div className="space-y-4">
      {/* Summary pills */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Live", count: live, color: "bg-green-100 text-green-700" },
          { label: "Submitted", count: submitted, color: "bg-blue-100 text-blue-700" },
          { label: "In Progress", count: inProgress, color: "bg-amber-100 text-amber-700" },
          { label: "Not Started", count: notStarted, color: "bg-brand-offwhite text-brand-muted" },
          ...(candidates > 0 ? [{ label: "Avery Candidates", count: candidates, color: "bg-brand-orange/10 text-brand-orange" }] : []),
        ].map(s => (
          <span key={s.label} className={clsx("text-xs px-2.5 py-1 rounded-full font-medium", s.color)}>
            {s.count} {s.label}
          </span>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-2 flex-wrap">
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
            className="text-xs border border-brand-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-orange bg-white">
            {PRIORITY_FILTERS.map(f => <option key={f}>{f}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-xs border border-brand-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-orange bg-white">
            {STATUS_FILTERS.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={handleResearch} disabled={researching}
            className={clsx("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              researching
                ? "bg-brand-offwhite text-brand-muted border-brand-border cursor-not-allowed"
                : "bg-white border-brand-border text-brand-muted hover:bg-brand-offwhite hover:text-brand-black")}>
            {researching ? "Researching…" : "Research with Avery"}
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-orange text-white hover:bg-brand-orange/90 transition-colors">
            + Add Directory
          </button>
        </div>
      </div>

      {researchMsg && (
        <p className="text-xs text-brand-orange bg-brand-orange/5 border border-brand-orange/20 rounded-lg px-3 py-2">
          {researchMsg}
        </p>
      )}

      {/* Table */}
      <div className="card p-0 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-xs text-brand-muted">Loading…</div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-red-600">{error}</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-brand-border bg-brand-offwhite/50">
                {["Directory", "Priority", "Cost", "Complexity", "Status", "Date", "Notes", ""].map(h => (
                  <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-brand-muted">No directories match the current filters.</td></tr>
              ) : (
                filtered.map(dir => (
                  <DirectoryRow key={dir.id} dir={dir} onUpdate={handleUpdate} onDelete={handleDelete} />
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddDirectoryModal
          onClose={() => setShowAdd(false)}
          onCreated={newDir => setDirs(prev => [newDir as Directory, ...prev])}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/(dashboard)/marketing/page.tsx`**

```typescript
"use client";
import { useState } from "react";
import clsx from "clsx";
import DirectoriesTab from "./DirectoriesTab";
import AdvertisingTab from "./AdvertisingTab";

const TABS = [
  { id: "directories", label: "Directories" },
  { id: "advertising", label: "Advertising" },
] as const;

type TabId = typeof TABS[number]["id"];

export default function MarketingPage() {
  const [tab, setTab] = useState<TabId>("directories");

  return (
    <div className="p-4 md:p-8 pt-16 md:pt-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-brand-black">Marketing</h1>
        <p className="text-sm text-brand-muted mt-0.5">Directory submissions and advertising channels</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-brand-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t.id
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-muted hover:text-brand-black"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "directories" && <DirectoriesTab />}
      {tab === "advertising" && <AdvertisingTab />}
    </div>
  );
}
```

- [ ] **Step 5: Build check**

```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
# Expected: ✓ Compiled — no TypeScript errors
```

- [ ] **Step 6: Dev-server smoke test**

```bash
npm run dev
# Open http://localhost:3000/marketing
# Verify:
#   - "Marketing" appears in the Sales & Marketing sub-nav
#   - 25 directory rows load in the Directories tab
#   - Status badges are color-coded
#   - Clicking a status badge opens an inline dropdown; selecting a value saves it
#   - "Advertising" tab shows the placeholder state
#   - "+ Add Directory" button opens the modal; submitting adds a row at the top
```

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/marketing/
git commit -m "feat: Marketing page — directories table with inline editing, add modal, advertising placeholder"
```

---

## Task 5: Avery research integration

**Prerequisite:** This task touches the `avery-agent` repo on OVH. Changes must be made via a GitHub PR to `Rosenfelt-Group/avery-agent` and deployed on OVH with `docker compose build && up -d`.

**Files (avery-agent repo):**
- Create: `tools/directory_research_tools.py`
- Modify: `tools/__init__.py` — register `research_directories_tool` (+1 tool, assert count bumped)
- Modify: `main.py` — add `POST /research-directories` endpoint

**Files (dashboard repo):**
- Create: `src/app/api/marketing/directories/research/route.ts`

**Interfaces:**
- `POST /research-directories` on Avery accepts no body; returns `{ candidates: DirectoryCandidate[] }` where:
  ```python
  # DirectoryCandidate shape (dict):
  # { name: str, url: str, priority_tier: str, cost: str|None,
  #   complexity: str|None, notes: str|None }
  ```
- Dashboard `POST /api/marketing/directories/research` calls Avery, inserts candidates as `is_candidate=true` rows, returns `{ added: int }`.

- [ ] **Step 1: Create `tools/directory_research_tools.py` in avery-agent**

```python
"""Tool: research new directory listing opportunities for Rosably."""
import os
from tavily import TavilyClient

_tavily = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])

QUERIES = [
    "AI consulting business directories United States 2025",
    "nonprofit technology vendor directory listing",
    "Cleveland Ohio business directory professional services",
    "B2B consultant directory submit listing free",
]

def research_directories() -> list[dict]:
    """Search for new directory listing opportunities not already known."""
    candidates = []
    seen_urls = set()

    for query in QUERIES:
        try:
            results = _tavily.search(query, max_results=5, search_depth="basic")
            for r in results.get("results", []):
                url = r.get("url", "").split("/")[2]  # domain only
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                candidates.append({
                    "name": r.get("title", url)[:80],
                    "url": url,
                    "priority_tier": "Submit Soon",
                    "cost": None,
                    "complexity": "Moderate",
                    "notes": (r.get("content", "") or "")[:200] or None,
                })
        except Exception:
            continue  # one failing query never aborts the others

    return candidates[:20]  # cap at 20 candidates per run
```

- [ ] **Step 2: Register the tool in `tools/__init__.py`**

Add to the imports at the top of `tools/__init__.py`:
```python
from tools.directory_research_tools import research_directories
```

Add `research_directories` to `ALL_TOOLS` list and bump the assert count by 1 (e.g., if current assert is `assert len(ALL_TOOLS) == 33`, change to `34`).

- [ ] **Step 3: Add `/research-directories` endpoint to `main.py`**

In `avery-agent/main.py`, import and add:
```python
from tools.directory_research_tools import research_directories

@app.post("/research-directories")
async def research_directories_endpoint(request: Request):
    secret = request.headers.get("X-Webhook-Secret", "")
    if secret != os.environ.get("WEBHOOK_SECRET", ""):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    candidates = research_directories()
    return JSONResponse({"candidates": candidates})
```

- [ ] **Step 4: Create `src/app/api/marketing/directories/research/route.ts` in dashboard**

```typescript
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 45;

export async function POST() {
  const averyUrl = process.env.AVERY_API_URL;
  const secret = process.env.AVERY_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET;

  if (!averyUrl || !secret) {
    return NextResponse.json({ error: "Avery not configured" }, { status: 500 });
  }

  // Fetch existing URLs to deduplicate
  const { data: existing } = await supabaseAdmin
    .from("directories")
    .select("url");
  const knownUrls = new Set((existing ?? []).map((r: { url: string }) => r.url));

  const res = await fetch(`${averyUrl}/research-directories`, {
    method: "POST",
    headers: { "X-Webhook-Secret": secret },
  });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Avery returned ${res.status}`, detail: text }, { status: 502 });
  }

  const { candidates } = await res.json() as { candidates: Record<string, unknown>[] };
  const fresh = candidates.filter(c => !knownUrls.has(c.url as string));

  if (fresh.length === 0) {
    return NextResponse.json({ added: 0 });
  }

  const rows = fresh.map(c => ({
    ...c,
    status: "Not Started",
    is_candidate: true,
    source: "avery_research",
  }));

  const { data, error } = await supabaseAdmin
    .from("directories")
    .insert(rows)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ added: (data ?? []).length });
}
```

- [ ] **Step 5: Check `AVERY_API_URL` env var is set in dashboard**

```bash
# On OVH, check the dashboard's Vercel env vars:
# AVERY_API_URL should be set (e.g., https://avery.rosably.com)
# If not, add it in the Vercel dashboard for the rosenfelt-dashboard project.
grep -r "AVERY" /opt/rosenfelt/rosenfelt-dashboard/.env* 2>/dev/null || echo "not in local env"
```

- [ ] **Step 6: Build check (dashboard)**

```bash
npm run build 2>&1 | grep -E "error TS|Error:|✓ Compiled"
```

- [ ] **Step 7: Open avery-agent PR on GitHub**

```bash
# From OVH, in /opt/avery-agent:
git checkout -b feat/research-directories
git add tools/directory_research_tools.py tools/__init__.py main.py
git commit -m "feat: research-directories endpoint + tool for directory listing discovery"
gh pr create --title "feat: research-directories endpoint" \
  --body "Adds POST /research-directories (webhook-secret-gated). Uses Tavily to search 4 queries for new directory listing opportunities. Returns up to 20 deduplicated candidates. Bumps tool count +1."
```

- [ ] **Step 8: After Brian merges and deploys on OVH**

```bash
# On OVH:
cd /opt/avery-agent && git pull && docker compose build && docker compose up -d
# Verify:
curl -s -X POST -H "X-Webhook-Secret: $WEBHOOK_SECRET" https://avery.rosably.com/research-directories | python3 -m json.tool
# Expected: { "candidates": [...] }
```

- [ ] **Step 9: Commit dashboard research route**

```bash
git add src/app/api/marketing/directories/research/
git commit -m "feat: /api/marketing/directories/research — proxy to Avery research endpoint"
```

---

## Self-Review

**Spec coverage check:**
- [x] Supabase table as source of truth — Task 1
- [x] Migrate existing 25 rows from markdown — Task 1 seed INSERT
- [x] Dashboard page under Sales & Marketing — Tasks 3, 4
- [x] Inline status editing — `DirectoryRow` status dropdown in Task 4
- [x] Filter by priority and status — Task 4 filter controls
- [x] "+ Add Directory" manual entry — Task 4 `AddDirectoryModal`
- [x] "Research with Avery" button — Task 4 `handleResearch` + Task 5 routes
- [x] Avery candidates shown with orange border, approve/dismiss actions — Task 4 `DirectoryRow`
- [x] Advertising placeholder tab — Task 4 `AdvertisingTab`
- [x] Nav wired up — Task 3

**Placeholder scan:** No TBDs, no "implement later", no "similar to Task N" — all code blocks are complete.

**Type consistency:** `Directory` interface defined identically in `route.ts` comments and all UI files. `handleUpdate` accepts `Partial<Directory>`. `onCreated` uses `Record<string, unknown>` cast to `Directory` — consistent with the POST response shape.
