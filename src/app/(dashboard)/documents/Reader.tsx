"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import clsx from "clsx";
import { docTypeLabel, docAudienceLabel, docStatusLabel, DOC_STATUS_COLORS, DocStatus } from "@/lib/doc-types";

export interface ReaderDoc {
  id: number;
  name: string;
  path: string;
  doc_type: string;
  status: string;
  audience: string;
}

export interface ReaderProps {
  doc: ReaderDoc;
  mode: "fullscreen" | "panel";
  onClose: () => void;
  onToggleMode: () => void;
  onEditMetadata: () => void;
}

export default function Reader({ doc, mode, onClose, onToggleMode, onEditMetadata }: ReaderProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // URL-backed docs (e.g. PDFs proxied through dashboard routes like
  // /api/work/[id]/deliverable.pdf) are rendered directly via an iframe,
  // never through the /api/docs JSON content fetch below — /api/docs would
  // either 404 (no doc_registry.content/storage_path for these rows) or,
  // for a real storage_path-backed binary file, return raw bytes that
  // ReactMarkdown can't render.
  const isUrlBacked = doc.path.startsWith("/api/") || doc.path.endsWith(".pdf");

  useEffect(() => {
    if (isUrlBacked) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    setDownloadUrl(null);
    fetch(`/api/docs?path=${encodeURIComponent(doc.path)}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, status: r.status, data })))
      .then(({ ok, status, data }) => {
        if (cancelled) return;
        if (!ok) {
          // /api/docs returns 404 for three distinct cases: row not found,
          // no content and no storage_path (this is the one we treat as an
          // empty state — a path opened here always came from an
          // already-fetched doc_registry row, so this specific message can
          // only mean "no content available"), or a broken Storage object
          // fetch ("Storage object not found") — that one is a real
          // data-integrity error and must still surface, not be hidden.
          if (status === 404 && data.error === "Document not found") setContent("");
          else setError(data.error ?? "Failed to load file");
        } else if (data.binary) {
          // Storage-backed non-text file (e.g. .pptx) — never decoded as
          // text, since arbitrary binary bytes aren't valid UTF-8.
          setDownloadUrl(data.downloadUrl);
        } else {
          setContent(data.content ?? "");
        }
      })
      .catch(() => { if (!cancelled) setError("Network error loading file"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [doc.path, isUrlBacked]);

  useEffect(() => {
    if (mode !== "fullscreen") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const statusColor = DOC_STATUS_COLORS[doc.status as DocStatus] ?? "bg-gray-100 text-gray-600 border-gray-200";

  const body = (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-brand-border flex items-center gap-3 flex-wrap flex-shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-black truncate">{doc.name}</p>
          <p className="text-[11px] text-brand-muted font-mono truncate">{doc.path}</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded border bg-brand-offwhite text-brand-black border-brand-border">
          {docTypeLabel(doc.doc_type)}
        </span>
        <span className={clsx("text-[10px] px-2 py-0.5 rounded border", statusColor)}>
          {docStatusLabel(doc.status)}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded border bg-brand-offwhite text-brand-black border-brand-border">
          {docAudienceLabel(doc.audience)}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onEditMetadata} className="text-xs px-2.5 py-1 rounded border border-brand-border hover:bg-brand-offwhite text-brand-black">
            Edit metadata
          </button>
          <button onClick={onToggleMode} className="text-xs px-2.5 py-1 rounded border border-brand-border hover:bg-brand-offwhite text-brand-black">
            {mode === "fullscreen" ? "Collapse to panel" : "Expand"}
          </button>
          <button onClick={onClose} className="text-xs px-2.5 py-1 rounded border border-brand-border hover:bg-brand-offwhite text-brand-black">
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isUrlBacked ? (
          /* PDFs and other URL-proxied docs render inline via the browser's
             PDF viewer rather than through the /api/docs content fetch. */
          <div className="flex flex-col gap-2 h-full p-4">
            <div className="flex items-center justify-between gap-3 text-xs text-brand-muted flex-shrink-0">
              <span>{doc.name}</span>
              <a href={doc.path} target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">
                Open in new tab ↗
              </a>
            </div>
            <iframe src={doc.path} title={doc.name} className="flex-1 w-full border border-brand-border rounded-lg" />
          </div>
        ) : (
          <div className="max-w-[900px] mx-auto px-8 py-8">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => <div key={i} className="animate-pulse h-4 bg-brand-offwhite rounded" style={{ width: `${60 + i * 8}%` }} />)}
              </div>
            ) : error ? (
              <div className="text-sm text-red-600 bg-red-50 rounded-lg p-4">{error}</div>
            ) : downloadUrl ? (
              <div className="text-center py-16">
                <p className="text-sm text-brand-muted mb-3">This file type can&apos;t be previewed here.</p>
                <a href={downloadUrl} className="text-sm text-brand-orange hover:underline">
                  Download {doc.name} ↓
                </a>
              </div>
            ) : !content ? (
              <div className="text-center py-16">
                <p className="text-sm text-brand-muted">No indexed content yet.</p>
              </div>
            ) : doc.path.endsWith(".md") ? (
              <div className="prose prose-sm max-w-none
                prose-headings:font-semibold prose-headings:text-brand-black
                prose-p:text-brand-black prose-p:leading-relaxed
                prose-a:text-brand-orange prose-a:no-underline hover:prose-a:underline
                prose-strong:text-brand-black prose-li:text-brand-black
                prose-code:bg-gray-200 prose-code:text-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                prose-pre:bg-gray-200 prose-pre:text-gray-800 prose-pre:rounded-lg prose-pre:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              /* Non-markdown content (e.g. a storage-backed binary file) is
                 shown as raw text rather than risking a markdown-parse of
                 arbitrary bytes. */
              <pre className="text-xs text-brand-black font-mono whitespace-pre-wrap break-words bg-brand-offwhite rounded-lg p-4">
                {content}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (mode === "fullscreen") {
    return <div className="fixed inset-0 z-50">{body}</div>;
  }
  // Self-positioned (matches the fullscreen branch above) rather than relying
  // on a wrapper div in the caller: a percentage width on a plain in-flow div
  // placed inside a `fixed` container with no explicit `left`/width is
  // undefined per the CSS shrink-to-fit rules, which is what let this panel
  // render off-center instead of docked to the right at a fixed width.
  return <div className="fixed inset-y-0 right-0 z-40 w-[45%] flex-shrink-0 border-l border-brand-border">{body}</div>;
}
