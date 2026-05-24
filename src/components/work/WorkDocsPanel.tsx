"use client";

import { useEffect, useState } from "react";
import type { WorkItemDoc } from "@/types";
import { VpsBrowserModal } from "./VpsBrowserModal";

type Props = { workItemId: string };

export function WorkDocsPanel({ workItemId }: Props) {
  const [docs, setDocs] = useState<WorkItemDoc[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showGoogleDocModal, setShowGoogleDocModal] = useState(false);
  const [googleDocUrl, setGoogleDocUrl] = useState("");
  const [googleDocName, setGoogleDocName] = useState("");

  async function loadDocs() {
    const res = await fetch(`/api/work/${workItemId}/docs`);
    if (!res.ok) return;
    const data = await res.json();
    setDocs(data.docs ?? []);
  }

  useEffect(() => {
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemId]);

  async function unlink(docId: string) {
    if (!confirm("Unlink this document from the work item? (Doc stays in the registry.)")) return;
    const res = await fetch(`/api/work/${workItemId}/docs/${docId}`, {
      method: "DELETE",
    });
    if (res.ok) await loadDocs();
  }

  async function linkGoogleDoc() {
    if (!googleDocUrl.trim() || !googleDocName.trim()) return;
    const res = await fetch(`/api/work/${workItemId}/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: googleDocName,
        path: googleDocUrl,
        google_doc_url: googleDocUrl,
      }),
    });
    if (res.ok) {
      setShowGoogleDocModal(false);
      setGoogleDocName("");
      setGoogleDocUrl("");
      await loadDocs();
    }
  }

  async function attachVpsFile(filePath: string) {
    const name = filePath.split("/").pop() || filePath;
    await fetch(`/api/work/${workItemId}/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, path: filePath }),
    });
    await loadDocs();
  }

  return (
    <div>
      <div className="text-xs font-semibold mb-2 text-brand-muted uppercase tracking-wide">
        Documents
      </div>
      <div className="space-y-1">
        {docs.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-brand-cream"
          >
            <span>📄</span>
            <div className="flex-1 min-w-0">
              <div className="truncate text-brand-black font-medium">{d.name}</div>
              <div className="text-[10px] text-brand-muted truncate font-mono">{d.path}</div>
            </div>
            {d.google_doc_url ? (
              <a
                href={d.google_doc_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-orange"
                title="Open in Google Drive"
              >
                ↗
              </a>
            ) : (
              <span title={d.path} className="text-brand-muted">↗</span>
            )}
            <button
              onClick={() => unlink(d.id)}
              className="text-brand-muted hover:text-red-600"
              title="Unlink"
            >
              ×
            </button>
          </div>
        ))}
        {docs.length === 0 && (
          <div className="text-xs text-brand-muted px-2">No documents attached yet.</div>
        )}
      </div>
      <div className="flex gap-2 mt-3 text-xs">
        <button
          onClick={() => setShowBrowser(true)}
          className="rounded border border-brand-border px-2 py-1 hover:bg-brand-cream"
        >
          + Browse VPS
        </button>
        <button
          onClick={() => setShowGoogleDocModal(true)}
          className="rounded border border-brand-border px-2 py-1 hover:bg-brand-cream"
        >
          + Link Google Doc
        </button>
      </div>

      {showBrowser && (
        <VpsBrowserModal
          onClose={() => setShowBrowser(false)}
          onSelect={async (filePath) => {
            await attachVpsFile(filePath);
            setShowBrowser(false);
          }}
        />
      )}

      {showGoogleDocModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded p-4 w-96 space-y-3 shadow-xl">
            <h3 className="font-semibold text-brand-black text-sm">Link Google Doc</h3>
            <input
              value={googleDocName}
              onChange={(e) => setGoogleDocName(e.target.value)}
              placeholder="Document name"
              className="w-full rounded border border-brand-border px-2 py-1 text-xs"
            />
            <input
              value={googleDocUrl}
              onChange={(e) => setGoogleDocUrl(e.target.value)}
              placeholder="Google Drive URL"
              className="w-full rounded border border-brand-border px-2 py-1 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowGoogleDocModal(false)}
                className="px-3 py-1 text-xs hover:bg-brand-cream rounded"
              >
                Cancel
              </button>
              <button
                onClick={linkGoogleDoc}
                className="rounded bg-brand-orange text-white px-3 py-1 text-xs"
              >
                Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
