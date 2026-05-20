"use client";
import { useState, useRef, useEffect, useCallback } from "react";

interface SchemaColumn { name: string; type: string }
interface SchemaTable  { name: string; columns: SchemaColumn[] }

interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  savedAt: string;
}

interface QueryResult {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  row_count: number;
  duration_ms: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "sql-saved-queries";

function loadSaved(): SavedQuery[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

function persistSaved(qs: SavedQuery[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(qs)); } catch {}
}

function formatCell(cell: string | number | boolean | null): string {
  if (cell === null) return "";
  if (typeof cell === "boolean") return cell ? "true" : "false";
  return String(cell);
}

// Extract the current word being typed at cursor position
function wordAtCursor(text: string, cursor: number): string {
  const before = text.slice(0, cursor);
  // Check for table.partial pattern
  const dot = before.match(/\b(\w+)\.(\w*)$/);
  if (dot) return dot[2]; // return only the column fragment
  const w = before.match(/\w+$/);
  return w?.[0] ?? "";
}

function prefixAtCursor(text: string, cursor: number): string {
  // Returns text before the current word (for replacement)
  const before = text.slice(0, cursor);
  const dot = before.match(/^([\s\S]*\b\w+\.)(\w*)$/);
  if (dot) return dot[1];
  const w = before.match(/^([\s\S]*?)(\w+)$/);
  return w ? w[1] : before;
}

function getSuggestions(text: string, cursor: number, tables: SchemaTable[]): string[] {
  if (!tables.length) return [];
  const before = text.slice(0, cursor);

  // table.col pattern
  const dotMatch = before.match(/\b(\w+)\.(\w*)$/);
  if (dotMatch) {
    const tbl = tables.find(t => t.name.toLowerCase() === dotMatch[1].toLowerCase());
    if (!tbl) return [];
    const partial = dotMatch[2].toLowerCase();
    return tbl.columns.filter(c => c.name.toLowerCase().startsWith(partial)).map(c => c.name).slice(0, 12);
  }

  const wordMatch = before.match(/\w+$/);
  const word = wordMatch?.[0] ?? "";
  if (word.length < 2) return [];
  const lower = word.toLowerCase();

  // After table-introducing keyword → only table names
  const afterKw = /\b(FROM|JOIN|INTO|UPDATE|TABLE|EXISTS|TRUNCATE)\s+\w*$/i.test(before);
  if (afterKw) {
    return tables.filter(t => t.name.toLowerCase().startsWith(lower)).map(t => t.name).slice(0, 12);
  }

  // Both tables and unique column names
  const tblMatches = tables.filter(t => t.name.toLowerCase().startsWith(lower)).map(t => t.name);
  const colMatches = [...new Set(tables.flatMap(t => t.columns.map(c => c.name)))]
    .filter(c => c.toLowerCase().startsWith(lower));
  return [...tblMatches, ...colMatches].slice(0, 12);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SupabaseSqlQuery() {
  const [sql,           setSql]           = useState("");
  const [result,        setResult]        = useState<QueryResult | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [tables,        setTables]        = useState<SchemaTable[]>([]);
  const [suggestions,   setSuggestions]   = useState<string[]>([]);
  const [suggIdx,       setSuggIdx]       = useState(0);
  const [savedQueries,  setSavedQueries]  = useState<SavedQuery[]>([]);
  const [showSaved,     setShowSaved]     = useState(false);
  const [showSchema,    setShowSchema]    = useState(false);
  const [saveOpen,      setSaveOpen]      = useState(false);
  const [saveName,      setSaveName]      = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cursorRef   = useRef(0);

  // Load schema on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/supabase/schema");
        if (!res.ok) return;
        const { tables: t } = await res.json();
        if (Array.isArray(t)) setTables(t);
      } catch {}
    }
    load();
    setSavedQueries(loadSaved());
  }, []);

  const runQuery = useCallback(async () => {
    const trimmed = sql.trim();
    if (!trimmed) return;
    setSuggestions([]);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res  = await fetch("/api/supabase/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.detail ?? "Query failed");
      else         setResult(body);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [sql]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val    = e.target.value;
    const cursor = e.target.selectionStart ?? 0;
    cursorRef.current = cursor;
    setSql(val);
    setSuggIdx(0);
    setSuggestions(getSuggestions(val, cursor, tables));
  }

  function applySuggestion(word: string) {
    const cursor = cursorRef.current;
    const before = sql.slice(0, cursor);
    const after  = sql.slice(cursor);

    // Determine where the partial word starts
    const dot = before.match(/^([\s\S]*\b\w+\.)(\w*)$/);
    const plain = before.match(/^([\s\S]*?)(\w+)$/);

    let newBefore: string;
    if (dot) {
      newBefore = dot[1] + word;
    } else if (plain) {
      newBefore = plain[1] + word;
    } else {
      newBefore = before + word;
    }

    const newSql = newBefore + after;
    setSql(newSql);
    setSuggestions([]);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newBefore.length, newBefore.length);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); applySuggestion(suggestions[suggIdx]); return; }
      if (e.key === "Escape")    { setSuggestions([]); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runQuery(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "s")     { e.preventDefault(); setSaveOpen(true); }
  }

  function handleSave() {
    if (!saveName.trim() || !sql.trim()) return;
    const q: SavedQuery = { id: Date.now().toString(), name: saveName.trim(), sql: sql.trim(), savedAt: new Date().toISOString() };
    const updated = [q, ...savedQueries];
    setSavedQueries(updated);
    persistSaved(updated);
    setSaveOpen(false);
    setSaveName("");
  }

  function deleteQuery(id: string) {
    const updated = savedQueries.filter(q => q.id !== id);
    setSavedQueries(updated);
    persistSaved(updated);
  }

  return (
    <div className="space-y-3">
      {/* Editor */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">SQL Query</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSchema(s => !s)}
              className="text-xs px-2 py-1 rounded-md bg-brand-offwhite hover:bg-brand-border text-brand-muted transition-colors"
            >
              {showSchema ? "Hide schema" : "Schema"}
            </button>
            <button
              onClick={() => setShowSaved(s => !s)}
              className="text-xs px-2 py-1 rounded-md bg-brand-offwhite hover:bg-brand-border text-brand-muted transition-colors"
            >
              Saved {savedQueries.length > 0 && `(${savedQueries.length})`}
            </button>
          </div>
        </div>

        {/* Schema browser */}
        {showSchema && (
          <div className="border border-brand-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-brand-offwhite border-b border-brand-border">
              <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider">Tables — {tables.length} total</p>
            </div>
            <div className="divide-y divide-brand-border max-h-56 overflow-y-auto">
              {tables.map(t => (
                <details key={t.name} className="group">
                  <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs font-medium text-brand-black hover:bg-brand-offwhite list-none">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                         className="group-open:rotate-90 transition-transform text-brand-muted flex-shrink-0">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    <span className="font-mono">{t.name}</span>
                    <span className="text-brand-muted font-normal ml-auto">{t.columns.length} cols</span>
                  </summary>
                  <div className="px-6 pb-2 space-y-0.5">
                    {t.columns.map(c => (
                      <div key={c.name} className="flex items-center gap-2 text-[11px]">
                        <button
                          onClick={() => {
                            const ins = `${t.name}.${c.name}`;
                            const ta = textareaRef.current;
                            if (!ta) return;
                            const start = ta.selectionStart;
                            const end   = ta.selectionEnd;
                            const newSql = sql.slice(0, start) + ins + sql.slice(end);
                            setSql(newSql);
                            setSuggestions([]);
                            requestAnimationFrame(() => {
                              ta.focus();
                              ta.setSelectionRange(start + ins.length, start + ins.length);
                            });
                          }}
                          className="font-mono text-brand-black hover:text-brand-orange transition-colors"
                        >
                          {c.name}
                        </button>
                        <span className="text-brand-muted">{c.type}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* Saved queries panel */}
        {showSaved && (
          <div className="border border-brand-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-brand-offwhite border-b border-brand-border">
              <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider">Saved Queries</p>
            </div>
            {savedQueries.length === 0 ? (
              <p className="text-xs text-brand-muted text-center py-4">No saved queries yet. Run a query and press ⌘S to save.</p>
            ) : (
              <div className="divide-y divide-brand-border max-h-48 overflow-y-auto">
                {savedQueries.map(q => (
                  <div key={q.id} className="flex items-center gap-2 px-3 py-2 hover:bg-brand-offwhite group">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-brand-black truncate">{q.name}</p>
                      <p className="text-[10px] text-brand-muted font-mono truncate mt-0.5">{q.sql.slice(0, 60)}{q.sql.length > 60 ? "…" : ""}</p>
                    </div>
                    <button
                      onClick={() => { setSql(q.sql); setShowSaved(false); setSuggestions([]); requestAnimationFrame(() => textareaRef.current?.focus()); }}
                      className="text-xs text-brand-orange hover:underline flex-shrink-0"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteQuery(q.id)}
                      className="text-[10px] text-brand-muted hover:text-red-600 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Textarea + autocomplete */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSuggestions([]), 150)}
            placeholder="SELECT * FROM tasks LIMIT 10;"
            rows={6}
            className="w-full font-mono text-xs border border-brand-border rounded-md px-3 py-2.5 bg-brand-offwhite focus:outline-none focus:ring-1 focus:ring-brand-orange resize-y"
            spellCheck={false}
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-brand-border rounded-lg shadow-lg overflow-hidden max-h-40 overflow-y-auto">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  onMouseDown={e => { e.preventDefault(); applySuggestion(s); }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors ${i === suggIdx ? "bg-orange-50 text-brand-orange" : "text-brand-black hover:bg-brand-offwhite"}`}
                >
                  {s}
                </button>
              ))}
              <div className="px-3 py-1 border-t border-brand-border bg-brand-offwhite text-[10px] text-brand-muted">
                Tab / ↵ to accept · ↑↓ navigate · Esc dismiss
              </div>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runQuery}
            disabled={loading || !sql.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-brand-orange text-white disabled:opacity-40 hover:bg-brand-orange/90 transition-colors"
          >
            {loading ? "Running…" : "Run Query"}
          </button>
          <span className="text-xs text-brand-muted">⌘↵</span>

          <div className="w-px h-4 bg-brand-border" />

          {saveOpen ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setSaveOpen(false); setSaveName(""); } }}
                placeholder="Query name…"
                className="text-xs px-2 py-1 border border-brand-border rounded-md focus:outline-none focus:ring-1 focus:ring-brand-orange w-36"
              />
              <button onClick={handleSave} className="text-xs px-2 py-1 bg-brand-orange text-white rounded-md hover:bg-brand-orange/90 transition-colors">Save</button>
              <button onClick={() => { setSaveOpen(false); setSaveName(""); }} className="text-xs px-2 py-1 text-brand-muted hover:text-brand-black">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setSaveOpen(true)}
              disabled={!sql.trim()}
              className="text-xs px-2 py-1 rounded-md bg-brand-offwhite hover:bg-brand-border text-brand-muted disabled:opacity-40 transition-colors"
            >
              Save query ⌘S
            </button>
          )}

          {result && (
            <span className="text-xs text-brand-muted ml-auto">
              {result.row_count} {result.row_count === 1 ? "row" : "rows"} · {result.duration_ms}ms
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 font-mono whitespace-pre-wrap break-all">
          {error}
        </div>
      )}

      {/* Results */}
      {result && result.row_count === 0 && (
        <p className="text-xs text-brand-muted italic px-1">Query returned 0 rows.</p>
      )}

      {result && result.columns.length > 0 && result.row_count > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-brand-offwhite border-b border-brand-border">
                <tr>
                  {result.columns.map(col => (
                    <th key={col} className="px-3 py-2 text-left font-semibold text-brand-muted whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-t border-brand-border hover:bg-brand-offwhite/60">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-1.5 max-w-[320px] truncate">
                        {cell === null ? <span className="text-brand-muted italic">null</span> : formatCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
