"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui";

type Props = {
  onClose: () => void;
  onSelect: (filePath: string) => void;
};

export function VpsBrowserModal({ onClose, onSelect }: Props) {
  const [path, setPath] = useState("/opt/rosenfelt/docs");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse(p: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vps/browse?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Browse failed");
        setFiles([]);
      } else {
        setFiles(data.files ?? []);
        setPath(data.path ?? p);
      }
    } catch {
      setError("Browse failed");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    browse(path);
    // intentionally only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goUp() {
    const parts = path.split("/").filter(Boolean);
    if (parts.length <= 2) return;  // stop at /opt/rosenfelt
    const parent = "/" + parts.slice(0, -1).join("/");
    browse(parent);
  }

  return (
    <Modal open onClose={onClose} title="Browse VPS" size="xl">
      <div className="border-b border-brand-border pb-3 flex items-center gap-2">
        <button
          onClick={goUp}
          className="text-sm px-2 py-1 hover:bg-brand-cream rounded"
          title="Parent directory"
        >
          ↑
        </button>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && browse(path)}
          className="flex-1 rounded border border-brand-border px-2 py-1 text-xs font-mono"
        />
        <button
          onClick={() => browse(path)}
          className="text-xs px-2 py-1 border border-brand-border rounded hover:bg-brand-cream"
        >
          Go
        </button>
      </div>
      <div className="pt-3">
        {loading && <div className="text-xs text-brand-muted">Loading…</div>}
        {error && <div className="text-xs text-red-600" role="alert">{error}</div>}
        {!loading && !error && files.length === 0 && (
          <div className="text-xs text-brand-muted">No files found here.</div>
        )}
        <div className="space-y-1">
          {files.map((f) => (
            <button
              key={f}
              onClick={() => onSelect(f)}
              className="block w-full text-left px-2 py-1 text-xs hover:bg-brand-cream rounded font-mono"
              title={f}
            >
              {f.startsWith(path + "/") ? f.slice(path.length + 1) : f}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
