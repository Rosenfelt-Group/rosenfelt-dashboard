"use client";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";

interface Brief {
  id: string;
  topic: string;
  research_type: string | null;
  category: string | null;
  doc_id: string | null;
  storage_path: string | null;
  query_count: number | null;
  created_at: string;
  links: { business_id: string; name: string }[];
}

interface Org {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  sort_order: number;
}

export default function ResearchPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [briefsLoading, setBriefsLoading] = useState(true);
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

  const [loadError, setLoadError] = useState<string | null>(null);

  // Organization briefs (Avery's per-organization research) live on the organization page; hidden by default.
  const [showOrgBriefs, setShowOrgBriefs] = useState(false);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgQuery, setOrgQuery] = useState("");
  const [linkErr, setLinkErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJson<unknown>("/api/research/briefs"),
      fetchJson<unknown>("/api/research/categories"),
    ]).then(([briefsRes, catsRes]) => {
      if (briefsRes.ok) setBriefs(Array.isArray(briefsRes.data) ? briefsRes.data.map((b: Brief) => ({ ...b, links: b.links ?? [] })) : []);
      if (catsRes.ok) setCategories(Array.isArray(catsRes.data) ? catsRes.data : []);
      const failed = [briefsRes, catsRes].find(r => !r.ok);
      if (failed && !failed.ok) setLoadError(failed.error);
      setBriefsLoading(false);
    });
  }, []);

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

  async function openLinkPicker(briefId: string) {
    setLinkErr(null);
    setOrgQuery("");
    setLinkFor(cur => (cur === briefId ? null : briefId));
    if (orgs) return;
    const r = await fetchJson<unknown>("/api/crm/businesses");
    if (r.ok && Array.isArray(r.data)) {
      setOrgs((r.data as Org[]).map(o => ({ id: o.id, name: o.name })).sort((a, b) => a.name.localeCompare(b.name)));
    } else setLinkErr(r.ok ? "Couldn't load organizations" : r.error);
  }

  async function setBriefLink(brief: Brief, org: Org, link: boolean) {
    setLinkErr(null);
    const r = await fetchJson(`/api/research/briefs/${brief.id}/links`, {
      method: link ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: org.id }),
    });
    if (!r.ok) { setLinkErr(r.error); return; }
    setBriefs(prev => prev.map(b => b.id !== brief.id ? b : {
      ...b,
      links: link
        ? [...b.links, { business_id: org.id, name: org.name }].sort((x, y) => x.name.localeCompare(y.name))
        : b.links.filter(l => l.business_id !== org.id),
    }));
    if (link) setLinkFor(null);
  }

  const filteredBriefs = briefs.filter(
    b =>
      (!catFilter || b.category === catFilter) &&
      (!typeFilter || b.research_type === typeFilter) &&
      (showOrgBriefs || typeFilter === "business" || b.research_type !== "business")
  );
  const hiddenOrgBriefs = showOrgBriefs ? 0 : briefs.filter(b => b.research_type === "business").length;

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-5xl">
      <PageHeader
        title="Research"
        description="Avery's briefs on products, competitors and trends. Research about one organization lives on that organization's page."
      />
      {loadError && <ErrorState message={`Couldn't load research: ${loadError}`} className="mb-4" />}
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
            <Button onClick={runResearch} disabled={running || !researchTopic.trim()}>
              {running ? "Queuing…" : "Run"}
            </Button>
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
              <option value="business">Organization</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-brand-muted cursor-pointer">
              <input
                type="checkbox"
                checked={showOrgBriefs}
                onChange={e => setShowOrgBriefs(e.target.checked)}
                className="accent-brand-orange"
              />
              Show organization briefs{hiddenOrgBriefs ? ` (${hiddenOrgBriefs})` : ""}
            </label>
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
          <LoadingState />
        ) : filteredBriefs.length === 0 ? (
          <EmptyState title="No research briefs yet" description="Run a brief above to get started" />
        ) : (
          <div className="overflow-x-auto card [-webkit-overflow-scrolling:touch]">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Topic", "Category", "Type", "Queries", "Date", "Doc", ""].map(h => (
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
                  <Fragment key={b.id}>
                  <tr className="border-t border-brand-border">
                    <td className="px-3 py-2.5 text-sm text-brand-black font-medium max-w-xs">
                      {b.topic}
                      {b.links.length > 0 && (
                        <span className="block text-xs font-normal text-brand-muted mt-0.5">
                          Linked to{" "}
                          {b.links.map((l, i) => (
                            <span key={l.business_id}>
                              {i > 0 && ", "}
                              <Link href={`/crm/organizations/${l.business_id}?tab=research`} className="text-brand-orange hover:underline">
                                {l.name}
                              </Link>
                              <button
                                onClick={() => setBriefLink(b, { id: l.business_id, name: l.name }, false)}
                                className="ml-0.5 text-brand-muted hover:text-red-500"
                                aria-label={`Unlink ${l.name}`}
                                title="Unlink"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </span>
                      )}
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
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <button onClick={() => openLinkPicker(b.id)} className="text-xs text-brand-orange hover:underline">
                        {linkFor === b.id ? "Cancel" : "Link to organization…"}
                      </button>
                    </td>
                  </tr>
                  {linkFor === b.id && (
                    <tr>
                      <td colSpan={7} className="px-3 pb-3">
                        <div className="border border-brand-border rounded-lg p-3 space-y-2 bg-white">
                          <input
                            type="text"
                            value={orgQuery}
                            onChange={e => setOrgQuery(e.target.value)}
                            placeholder="Search organizations…"
                            autoFocus
                            className="w-full px-3 py-1.5 text-sm border border-brand-border rounded-lg focus:outline-none focus:border-brand-orange"
                          />
                          {linkErr && <p className="text-xs text-red-600">{linkErr}</p>}
                          {!orgs ? (
                            !linkErr && <p className="text-xs text-brand-muted">Loading…</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                              {orgs
                                .filter(o => !b.links.some(l => l.business_id === o.id))
                                .filter(o => !orgQuery.trim() || o.name.toLowerCase().includes(orgQuery.trim().toLowerCase()))
                                .slice(0, 60)
                                .map(o => (
                                  <button
                                    key={o.id}
                                    onClick={() => setBriefLink(b, o, true)}
                                    className="text-xs px-2.5 py-1 rounded-full border border-brand-border hover:border-brand-orange hover:text-brand-orange"
                                  >
                                    {o.name}
                                  </button>
                                ))}
                            </div>
                          )}
                          <p className="text-xs text-brand-muted">
                            Linking a brief puts it on that organization&apos;s Research tab, where you can choose to use it in the scope.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
              <Button size="sm" onClick={addCategory} disabled={catSaving || !newCatName.trim()}>
                {catSaving ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
