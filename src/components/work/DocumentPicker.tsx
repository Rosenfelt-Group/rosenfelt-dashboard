"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

type DocEntry = {
  id: number;
  name: string;
  path: string;
  category: string | null;
  description: string | null;
  google_doc_url: string | null;
  work_item_id: string | null;
  work_item_title: string | null;
};

type Props = {
  workItemId: string;
  onClose: () => void;
  onAttached: () => void;
};

function truncate(text: string | null, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function DocumentPicker({ workItemId, onClose, onAttached }: Props) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [attachingId, setAttachingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/docs/list");
        const data = await res.json();
        if (!cancelled) {
          setDocs(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load docs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce 200ms — keeps typing responsive without re-grouping on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery), 200);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? docs.filter((d) => {
          const name = (d.name ?? "").toLowerCase();
          const desc = (d.description ?? "").toLowerCase();
          return name.includes(q) || desc.includes(q);
        })
      : docs;

    const byCategory = new Map<string, DocEntry[]>();
    for (const d of filtered) {
      const cat = d.category || "Uncategorized";
      const list = byCategory.get(cat);
      if (list) list.push(d);
      else byCategory.set(cat, [d]);
    }
    // Alphabetize categories and entries within
    const result: Array<[string, DocEntry[]]> = Array.from(byCategory.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, list]) => [cat, list.sort((a, b) => a.name.localeCompare(b.name))]);
    return result;
  }, [docs, query]);

  async function attach(doc: DocEntry) {
    setAttachingId(doc.id);
    try {
      const res = await fetch(`/api/work/${workItemId}/docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: doc.name,
          path: doc.path,
          description: doc.description,
          google_doc_url: doc.google_doc_url,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
      }
      onAttached();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to attach");
    } finally {
      setAttachingId(null);
    }
  }

  const totalShown = grouped.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl flex flex-col max-h-[80vh]">
        <div className="px-4 py-3 border-b border-brand-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-brand-black text-sm">Attach document</h3>
            <button
              onClick={onClose}
              className="text-brand-muted hover:text-brand-black text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <input
            autoFocus
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search by name or description…"
            className="w-full rounded border border-brand-border px-3 py-1.5 text-sm focus:outline-none focus:border-brand-orange"
          />
          <p className="text-[11px] text-brand-muted mt-1">
            {loading ? "Loading…" : `${totalShown} document${totalShown === 1 ? "" : "s"}`}
            {query && !loading && ` matching "${query}"`}
          </p>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!loading && grouped.length === 0 && (
            <div className="text-xs text-brand-muted px-3 py-6 text-center">
              {query ? "No documents match." : "No documents in registry."}
            </div>
          )}
          {grouped.map(([category, list]) => (
            <div key={category} className="mb-3">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-brand-muted px-2 py-1">
                {category}
              </div>
              <div className="space-y-0.5">
                {list.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => attach(d)}
                    disabled={attachingId !== null}
                    className={clsx(
                      "w-full text-left px-3 py-2 rounded hover:bg-brand-offwhite transition",
                      "flex items-start gap-2",
                      attachingId === d.id && "opacity-60",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-brand-black truncate">
                          {d.name}
                        </span>
                        {d.google_doc_url && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            Drive
                          </span>
                        )}
                      </div>
                      {d.description && (
                        <div className="text-xs text-brand-muted truncate">
                          {truncate(d.description, 80)}
                        </div>
                      )}
                    </div>
                    {attachingId === d.id && (
                      <span className="text-[10px] text-brand-muted">Attaching…</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
