"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { MIN_QUERY } from "@/lib/crm/search";
import type { CRMContact } from "@/types";

const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";
const fullName = (c: CRMContact) => [c.first_name, c.last_name].filter(Boolean).join(" ");

/**
 * "Link to existing…": search people by name or email and pick one. When the inbox suggested an
 * organization, also offers to create the sender as a new person there.
 */
export function ContactPicker({
  disabled,
  createAt,
  onPick,
  onCreateAt,
}: {
  disabled: boolean;
  /** The suggested organization's name, if any. */
  createAt: string | null;
  onPick: (contactId: string) => void;
  onCreateAt: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CRMContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_QUERY) { setHits(null); setError(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const r = await fetchJson<CRMContact[]>(`/api/crm/contacts?q=${encodeURIComponent(term)}&limit=8`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (r.ok) { setHits(Array.isArray(r.data) ? r.data : []); setError(null); }
      else setError(r.error);
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  return (
    <div className="border border-brand-border rounded-lg p-2 space-y-1 bg-brand-offwhite">
      <input
        autoFocus
        className={INPUT}
        placeholder="Search people by name or email…"
        aria-label="Search people"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <p role="alert" className="text-xs text-red-700 px-1">{error}</p>}
      {hits && hits.length === 0 && <p className="text-xs text-brand-muted px-1 py-1">No people match “{q.trim()}”.</p>}
      {hits && hits.length > 0 && (
        <ul className="max-h-56 overflow-y-auto">
          {hits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(c.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white disabled:opacity-50"
              >
                <span className="text-sm text-brand-black truncate">{fullName(c) || c.email}</span>
                <span className="ml-auto text-xs text-brand-muted truncate">
                  {[c.business?.name, c.email].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {createAt && (
        <button
          type="button"
          disabled={disabled}
          onClick={onCreateAt}
          className="w-full text-left px-2 py-1.5 rounded-md text-sm text-brand-orange hover:bg-white disabled:opacity-50"
        >
          + Create a new person at {createAt}
        </button>
      )}
    </div>
  );
}
