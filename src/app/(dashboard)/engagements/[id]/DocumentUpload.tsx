"use client";
import { useRef, useState } from "react";
import { fetchJson } from "@/lib/rooms/fetch-json";
import { DOC_ACCEPT, DOC_MAX_BYTES } from "@/lib/rooms/doc-limits";

type Prep = { deliverable_id: string; upload_id: string; filename: string; signed_url: string; content_type: string };

// Upload a document (proposal, PDF, sheet…) as a draft version. The file goes from the browser
// straight to Storage via a signed upload URL; the server then verifies it before any row exists.
export function DocumentUpload({ engagementId, documents, onDone }: {
  engagementId: string; documents: { id: string; title: string }[]; onDone: (msg: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async () => {
    if (!file || inFlight.current) return;
    if (file.size > DOC_MAX_BYTES) { setErr("Files must be 25 MB or smaller."); return; }
    if (file.size === 0) { setErr("That file is empty."); return; }
    inFlight.current = true; setBusy(true); setErr(null);
    try {
      const prep = await fetchJson<Prep>(`/api/engagements/${engagementId}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, ...(targetId ? { deliverable_id: targetId } : { deliverable_title: title }) }),
      });
      if (!prep.ok) { setErr(prep.error); return; }
      let put: Response;
      try {
        put = await fetch(prep.data.signed_url, {
          method: "PUT", headers: { "content-type": prep.data.content_type, "x-upsert": "false" }, body: file,
        });
      } catch { setErr("Upload failed (network error). Try again."); return; }
      if (!put.ok) { setErr(`Upload failed (HTTP ${put.status}). Check the file is 25 MB or smaller and an allowed type.`); return; }
      const fin = await fetchJson<{ version_no: number }>(`/api/engagements/${engagementId}/documents/finalize`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliverable_id: prep.data.deliverable_id, upload_id: prep.data.upload_id, filename: file.name,
          ...(summary.trim() ? { change_summary: summary.trim() } : {}) }),
      });
      if (!fin.ok) { setErr(fin.error); return; }
      setFile(null); setTitle(""); setSummary(""); setTargetId("");
      if (fileInput.current) fileInput.current.value = "";
      onDone(`Uploaded “${prep.data.filename}” as v${fin.data.version_no} (draft). Use “Share with room” to make it visible.`);
    } finally {
      inFlight.current = false; setBusy(false);
    }
  };

  return (
    <div className="border border-brand-border rounded p-3 space-y-2">
      <h2 className="text-sm font-semibold">Upload document</h2>
      <p className="text-xs text-brand-muted">PDF, Word, Excel, PowerPoint, PNG, JPG, TXT, CSV or Markdown, up to 25 MB. Visitors can download it once you share it.</p>
      <select value={targetId} onChange={e => setTargetId(e.target.value)} className="border border-brand-border rounded px-2 py-1.5 text-sm">
        <option value="">New document…</option>
        {documents.map(d => <option key={d.id} value={d.id}>New version of: {d.title}</option>)}
      </select>
      {!targetId && (
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title (e.g. Proposal)"
          className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
      )}
      <input ref={fileInput} type="file" accept={DOC_ACCEPT} onChange={e => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
      <input value={summary} onChange={e => setSummary(e.target.value)} maxLength={500} placeholder="What changed? (optional)"
        className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
      <button disabled={busy || !file || (!targetId && !title.trim())} onClick={upload}
        className="px-3 py-1.5 text-sm rounded bg-brand-orange text-white disabled:opacity-50">
        {busy ? "Uploading…" : "Upload"}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
