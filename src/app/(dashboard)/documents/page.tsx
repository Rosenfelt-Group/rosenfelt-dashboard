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
