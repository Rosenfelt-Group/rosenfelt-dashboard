"use client";

import { useEffect, useState } from "react";
import type { WorkItemDoc } from "@/types";
import { docTypeLabel } from "@/lib/doc-types";
import { VpsBrowserModal } from "./VpsBrowserModal";
import { DocumentPicker } from "./DocumentPicker";

type Props = { workItemId: string };

function truncate(text: string | null, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function WorkDocsPanel({ workItemId }: Props) {
  const [docs, setDocs] = useState<WorkItemDoc[]>([]);
  const [showPicker, setShowPicker] = useState(false);
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
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
          Documents
        </div>
        <button
          onClick={() => setShowPicker(true)}
          className="rounded bg-brand-orange text-white text-xs px-2 py-1 hover:opacity-90"
        >
          + Attach Document
        </button>
      </div>
      <div className="space-y-2">
        {docs.map((d) => {
          // Anything served by a dashboard API route, or any .pdf, is
          // directly openable in a new tab. Markdown docs deep-link
          // into the Documents library so the user gets the markdown
          // viewer instead of raw text.
          const openHref =
            d.path.startsWith("/api/") || d.path.endsWith(".pdf")
              ? d.path
              : d.path.endsWith(".md")
              ? `/documents?path=${encodeURIComponent(d.path)}`
              : null;
          const NameTag: React.ElementType = openHref ? "a" : "span";
          const nameProps = openHref
            ? {
                href: openHref,
                target: "_blank" as const,
                rel: "noopener noreferrer",
                className:
                  "text-sm font-semibold text-brand-orange truncate hover:underline",
              }
            : { className: "text-sm font-semibold text-brand-black truncate" };
          return (
            <div
              key={d.id}
              className="rounded border border-brand-border p-2 hover:bg-brand-offwhite"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <NameTag {...nameProps}>{d.name}</NameTag>
                    {d.doc_type && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                        {docTypeLabel(d.doc_type)}
                      </span>
                    )}
                  </div>
                  {d.description && (
                    <div className="text-xs text-brand-muted mt-0.5">
                      {truncate(d.description, 80)}
                    </div>
                  )}
                  <div className="text-[10px] text-brand-muted truncate font-mono mt-1">
                    {d.path}
                  </div>
                </div>
                <button
                  onClick={() => unlink(d.id)}
                  className="text-brand-muted hover:text-red-600 text-sm"
                  title="Detach"
                >
                  ×
                </button>
              </div>
              {d.google_doc_url && (
                <a
                  href={d.google_doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-orange hover:underline inline-block mt-1"
                >
                  Open in Drive →
                </a>
              )}
            </div>
          );
        })}
        {docs.length === 0 && (
          <div className="text-xs text-brand-muted px-2 py-3 text-center border border-dashed border-brand-border rounded">
            No documents linked. Use &quot;+ Attach Document&quot; to add one.
          </div>
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

      {showPicker && (
        <DocumentPicker
          workItemId={workItemId}
          onClose={() => setShowPicker(false)}
          onAttached={loadDocs}
        />
      )}

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
