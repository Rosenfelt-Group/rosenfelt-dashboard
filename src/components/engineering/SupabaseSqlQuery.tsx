"use client";
import { useState, useRef } from "react";

interface QueryResult {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  row_count: number;
  duration_ms: number;
}

export function SupabaseSqlQuery() {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function runQuery() {
    const trimmed = sql.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/supabase/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? "Query failed");
      } else {
        setResult(body);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runQuery();
    }
  }

  function formatCell(cell: string | number | boolean | null): string {
    if (cell === null) return "";
    if (typeof cell === "boolean") return cell ? "true" : "false";
    return String(cell);
  }

  return (
    <div className="card space-y-3">
      <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">SQL Query</p>

      <textarea
        ref={textareaRef}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={"SELECT * FROM tasks LIMIT 10;"}
        rows={4}
        className="w-full font-mono text-xs border border-brand-border rounded-md px-3 py-2 bg-brand-offwhite focus:outline-none focus:ring-1 focus:ring-brand-orange resize-y"
        spellCheck={false}
      />

      <div className="flex items-center gap-3">
        <button
          onClick={runQuery}
          disabled={loading || !sql.trim()}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-brand-orange text-white disabled:opacity-40 hover:bg-brand-orange/90 transition-colors"
        >
          {loading ? "Running…" : "Run Query"}
        </button>
        <span className="text-xs text-brand-muted">⌘↵ to run</span>
        {result && (
          <span className="text-xs text-brand-muted ml-auto">
            {result.row_count} {result.row_count === 1 ? "row" : "rows"} · {result.duration_ms}ms
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 font-mono whitespace-pre-wrap break-all">
          {error}
        </div>
      )}

      {result && result.row_count === 0 && (
        <p className="text-xs text-brand-muted italic">Query returned 0 rows.</p>
      )}

      {result && result.columns.length > 0 && result.row_count > 0 && (
        <div className="overflow-x-auto rounded-md border border-brand-border">
          <table className="w-full text-xs font-mono">
            <thead className="bg-brand-offwhite border-b border-brand-border">
              <tr>
                {result.columns.map((col) => (
                  <th key={col} className="px-3 py-2 text-left font-semibold text-brand-muted whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="border-t border-brand-border hover:bg-brand-offwhite/60">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5 max-w-[320px] truncate">
                      {cell === null ? (
                        <span className="text-brand-muted italic">null</span>
                      ) : (
                        formatCell(cell)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
