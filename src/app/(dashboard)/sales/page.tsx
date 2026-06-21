// src/app/(dashboard)/sales/page.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";

type Tab = "overview" | "crm" | "content" | "quiz" | "research";

interface Brief {
  id: string;
  topic: string;
  research_type: string | null;
  category: string | null;
  doc_id: string | null;
  storage_path: string | null;
  query_count: number | null;
  created_at: string;
}

interface Category {
  id: string;
  name: string;
  sort_order: number;
}

export default function SalesPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [briefsLoading, setBriefsLoading] = useState(false);
  const [researchTopic, setResearchTopic] = useState("");
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState("");

  // Category state
  const [categories, setCategories] = useState<Category[]>([]);
  const [catFilter, setCatFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showManage, setShowManage] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [catSaving, setCatSaving] = useState(false);

  useEffect(() => {
    if (tab === "research") {
      setBriefsLoading(true);
      Promise.all([
        fetch("/api/research/briefs").then(r => r.json()),
        fetch("/api/research/categories").then(r => r.json()),
      ])
        .then(([briefsData, catsData]) => {
          setBriefs(Array.isArray(briefsData) ? briefsData : []);
          setCategories(Array.isArray(catsData) ? catsData : []);
        })
        .catch(() => {
          setBriefs([]);
          setCategories([]);
        })
        .finally(() => setBriefsLoading(false));
    }
  }, [tab]);

  async function runResearch() {
    if (!researchTopic.trim() || running) return;
    setRunning(true);
    setRunMsg("");
    try {
      const r = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: researchTopic }),
      });
      const data = await r.json();
      setRunMsg(data.ok ? "Research queued — Avery is on it." : (data.error ?? "Error"));
      if (data.ok) setResearchTopic("");
    } catch {
      setRunMsg("Network error");
    }
    setRunning(false);
  }

  async function updateBriefCategory(briefId: string, category: string) {
    // Optimistic update
    setBriefs(prev =>
      prev.map(b => (b.id === briefId ? { ...b, category: category || null } : b))
    );
    try {
      await fetch(`/api/research/briefs/${briefId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: category || null }),
      });
    } catch {
      // If it fails, the optimistic update stays — not critical
    }
  }

  async function addCategory() {
    const name = newCatName.trim();
    if (!name || catSaving) return;
    setCatSaving(true);
    try {
      const r = await fetch("/api/research/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        const cat = await r.json();
        setCategories(prev => [...prev, cat]);
        setNewCatName("");
      }
    } catch {
      // silent
    }
    setCatSaving(false);
  }

  async function deleteCategory(catId: string) {
    setCategories(prev => prev.filter(c => c.id !== catId));
    try {
      await fetch(`/api/research/categories/${catId}`, { method: "DELETE" });
    } catch {
      // silent
    }
  }

  const filteredBriefs = briefs.filter(
    b =>
      (!catFilter || b.category === catFilter) &&
      (!typeFilter || b.research_type === typeFilter)
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview",  label: "Overview" },
    { id: "crm",       label: "CRM" },
    { id: "content",   label: "Content" },
    { id: "quiz",      label: "Quiz Pipeline" },
    { id: "research",  label: "Research" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <h1 className="text-xl font-semibold text-brand-black mb-4">Sales &amp; Marketing</h1>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-brand-border mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-muted hover:text-brand-black"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: "CRM",            href: "/crm",                desc: "Leads · Clients · Contacts · Businesses", sub: "View pipeline" },
            { label: "Services Admin", href: "/crm/admin/services", desc: "Manage service offerings",                  sub: "Edit services" },
            { label: "Content",        href: "/content",            desc: "Blog pipeline: ideas → draft → publish",   sub: "Content queue" },
            { label: "Keywords",       href: "/content/keywords",   desc: "SEO keyword tracker",                       sub: "Track rankings" },
            { label: "Analytics",      href: "/analytics",          desc: "GA4 traffic + conversion data",             sub: "View analytics" },
            { label: "Quiz Funnel",    href: "/quiz",               desc: "AI Opportunity Review quiz leads",           sub: "View leads" },
          ].map(card => (
            <Link key={card.href} href={card.href}
              className="card flex flex-col gap-2 p-4 hover:border-brand-orange/40 transition-all group">
              <p className="text-sm font-semibold text-brand-black group-hover:text-brand-orange transition-colors">
                {card.label}
              </p>
              <p className="text-xs text-brand-muted flex-1">{card.desc}</p>
              <p className="text-xs text-brand-orange">{card.sub} →</p>
            </Link>
          ))}
        </div>
      )}

      {/* CRM tab */}
      {tab === "crm" && (
        <div className="space-y-4">
          <p className="text-sm text-brand-muted">
            Full CRM at{" "}
            <Link href="/crm" className="text-brand-orange hover:underline">/crm</Link>.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Leads",      href: "/crm/leads" },
              { label: "Clients",    href: "/crm/clients" },
              { label: "Contacts",   href: "/crm/contacts" },
              { label: "Businesses", href: "/crm/businesses" },
            ].map(l => (
              <Link key={l.href} href={l.href}
                className="card p-4 text-center hover:border-brand-orange/40 transition-all">
                <p className="text-sm font-medium text-brand-black">{l.label}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Content tab */}
      {tab === "content" && (
        <div className="space-y-4">
          <p className="text-sm text-brand-muted">
            Avery manages the blog pipeline. Use the Content page for the full view.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Content Pipeline", href: "/content",          desc: "Ideas → draft → approve → publish" },
              { label: "Keywords",         href: "/content/keywords", desc: "SEO rank tracker" },
              { label: "Analytics",        href: "/analytics",        desc: "GA4 traffic & conversions" },
            ].map(c => (
              <Link key={c.href} href={c.href}
                className="card p-4 hover:border-brand-orange/40 transition-all group">
                <p className="text-sm font-semibold text-brand-black group-hover:text-brand-orange transition-colors">
                  {c.label}
                </p>
                <p className="text-xs text-brand-muted mt-1">{c.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quiz tab */}
      {tab === "quiz" && (
        <div className="space-y-4">
          <p className="text-sm text-brand-muted">
            AI Opportunity Review quiz captures leads via Typeform → n8n → Supabase.
            Avery generates the Stack Audit report.
          </p>
          <Link href="/quiz"
            className="card p-4 inline-flex flex-col gap-1 hover:border-brand-orange/40 transition-all">
            <p className="text-sm font-semibold text-brand-black">Quiz Leads</p>
            <p className="text-xs text-brand-muted">View all submitted Opportunity Reviews</p>
          </Link>
        </div>
      )}

      {/* Research tab */}
      {tab === "research" && (
        <div className="space-y-4">
          {/* Run research form */}
          <div className="card p-4">
            <p className="text-sm font-medium text-brand-black mb-3">Run a Research Brief</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={researchTopic}
                onChange={e => setResearchTopic(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runResearch()}
                placeholder="e.g. AI scheduling tools for SMBs"
                className="flex-1 px-3 py-2 text-sm border border-brand-border rounded-lg focus:outline-none focus:border-brand-orange"
              />
              <button
                onClick={runResearch}
                disabled={running || !researchTopic.trim()}
                className="px-4 py-2 rounded-lg bg-brand-orange text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-orange/90 transition-colors"
              >
                {running ? "Queuing…" : "Run"}
              </button>
            </div>
            {runMsg && (
              <p className={clsx("text-xs mt-2", runMsg.includes("queued") ? "text-green-600" : "text-red-600")}>
                {runMsg}
              </p>
            )}
          </div>

          {/* Filter row */}
          {!briefsLoading && (
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                className="text-xs py-1 px-2 border border-brand-border rounded bg-white text-brand-black focus:outline-none focus:border-brand-orange"
              >
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="text-xs py-1 px-2 border border-brand-border rounded bg-white text-brand-black focus:outline-none focus:border-brand-orange"
              >
                <option value="">All types</option>
                <option value="competitor">Competitor</option>
                <option value="tool">Tool</option>
                <option value="trend">Trend</option>
              </select>
              <div className="flex-1" />
              <button
                onClick={() => setShowManage(v => !v)}
                className="text-xs text-brand-orange hover:underline"
              >
                Manage categories
              </button>
            </div>
          )}

          {/* Briefs table */}
          {briefsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="card animate-pulse h-16" />)}
            </div>
          ) : filteredBriefs.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-sm text-brand-muted">No research briefs yet</p>
              <p className="text-xs text-brand-muted mt-1">Run a brief above to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto card">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {["Topic", "Category", "Type", "Queries", "Date", "Doc"].map(h => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold text-brand-muted uppercase tracking-wider px-3 py-2.5 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBriefs.map(b => (
                    <tr key={b.id} className="border-t border-brand-border">
                      <td className="px-3 py-2.5 text-sm text-brand-black font-medium max-w-xs">
                        {b.topic}
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={b.category ?? ""}
                          onChange={e => updateBriefCategory(b.id, e.target.value)}
                          className="text-xs py-1 px-2 border border-brand-border rounded bg-white text-brand-black focus:outline-none focus:border-brand-orange"
                        >
                          <option value="">—</option>
                          {categories.map(c => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="capitalize text-xs text-brand-muted">
                          {b.research_type ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-brand-muted">
                          {b.query_count ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-xs text-brand-muted">
                          {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {b.storage_path ? (
                          <a
                            href={`/documents?path=${encodeURIComponent(b.storage_path)}`}
                            target="_blank"
                            className="text-xs text-brand-orange hover:underline"
                          >
                            View →
                          </a>
                        ) : (
                          <span className="text-xs text-brand-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Manage categories panel */}
          {showManage && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-brand-black">Categories</p>
                <button
                  onClick={() => setShowManage(false)}
                  className="text-xs text-brand-muted hover:text-brand-black"
                >
                  ✕
                </button>
              </div>
              {categories.length === 0 ? (
                <p className="text-xs text-brand-muted">No categories yet.</p>
              ) : (
                <ul className="space-y-1">
                  {categories.map(c => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-brand-black">{c.name}</span>
                      <button
                        onClick={() => deleteCategory(c.id)}
                        className="text-xs text-brand-muted hover:text-red-500"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addCategory()}
                  placeholder="New category name"
                  className="flex-1 px-3 py-1.5 text-sm border border-brand-border rounded-lg focus:outline-none focus:border-brand-orange"
                />
                <button
                  onClick={addCategory}
                  disabled={catSaving || !newCatName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-brand-orange text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-orange/90 transition-colors"
                >
                  {catSaving ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
