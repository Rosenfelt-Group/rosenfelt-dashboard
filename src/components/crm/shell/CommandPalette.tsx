"use client";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { fetchJson } from "@/lib/fetch-json";
import { EMPTY_RESULTS, MIN_QUERY, type SearchResults } from "@/lib/crm/search";
import { buildPaletteItems, INITIAL_PALETTE, paletteReducer, type NewKind, type PaletteItem } from "./palette";

/**
 * ⌘K search across organizations, people and deals, plus create and go-to actions. Arrow keys move,
 * Enter opens, Escape closes. Rendered only while open, so each opening starts empty.
 */
export function CommandPalette({ onClose, onCreate }: { onClose: () => void; onCreate: (kind: NewKind) => void }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(paletteReducer, INITIAL_PALETTE);
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search; a newer query aborts the one in flight.
  useEffect(() => {
    const term = state.query.trim();
    if (term.length < MIN_QUERY) { setResults(EMPTY_RESULTS); setLoading(false); setError(null); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await fetchJson<SearchResults>(`/api/crm/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setLoading(false);
      if (r.ok) { setResults(r.data); setError(null); }
      else { setResults(EMPTY_RESULTS); setError(r.error); }
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [state.query]);

  const items = useMemo(() => buildPaletteItems(results, state.query), [results, state.query]);
  const active = Math.min(state.active, Math.max(items.length - 1, 0));

  // Focus the input on open, lock page scroll, and give focus back on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; opener?.focus?.(); };
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(item: PaletteItem) {
    onClose();
    if ("create" in item) onCreate(item.create);
    else router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      dispatch({ type: "move", delta: e.key === "ArrowDown" ? 1 : -1, count: items.length });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // keep focus in the input; arrows move through the list
    }
  }

  const term = state.query.trim();
  const hasResults = results.organizations.length + results.people.length + results.deals.length > 0;
  const optionId = (i: number) => `crm-palette-opt-${i}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center px-4 pt-[12vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search the CRM" className="w-full max-w-xl bg-white rounded-xl shadow-xl overflow-hidden" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls="crm-palette-list"
          aria-activedescendant={items[active] ? optionId(active) : undefined}
          aria-autocomplete="list"
          value={state.query}
          onChange={e => dispatch({ type: "query", query: e.target.value })}
          placeholder="Search organizations, people, deals, or type a command…"
          className="w-full px-4 py-3.5 text-[15px] border-b border-brand-border focus:outline-none"
        />
        <div ref={listRef} id="crm-palette-list" role="listbox" aria-label="Results" className="max-h-[55vh] overflow-y-auto p-1.5">
          {error && <p role="alert" className="px-3 py-2 text-xs text-red-700">Search failed: {error}</p>}
          {term.length >= MIN_QUERY && !loading && !error && !hasResults && (
            <p className="px-3 py-2 text-xs text-brand-muted">No organizations, people or deals match “{term}”.</p>
          )}
          {loading && !hasResults && <p className="px-3 py-2 text-xs text-brand-muted">Searching…</p>}
          {items.map((item, i) => (
            <div key={item.key}>
              {(i === 0 || items[i - 1].group !== item.group) && (
                <div role="presentation" className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-brand-muted">
                  {item.group}
                </div>
              )}
              <div
                id={optionId(i)}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => { if (i !== active) dispatch({ type: "set", index: i }); }}
                onClick={() => choose(item)}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm",
                  i === active ? "bg-orange-50 text-brand-black" : "text-brand-black",
                )}
              >
                <span className="truncate">{item.label}</span>
                {item.detail && <span className="ml-auto text-xs text-brand-muted truncate max-w-[50%]">{item.detail}</span>}
                {!item.detail && i === active && <span className="ml-auto text-xs text-brand-muted">↵</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden sm:flex gap-4 px-4 py-2 border-t border-brand-border text-[11px] text-brand-muted">
          <span>↑↓ to move</span><span>↵ to open</span><span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
