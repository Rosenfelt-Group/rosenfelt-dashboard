"use client";
import { useState } from "react";
import clsx from "clsx";
import {
  DOC_TYPES, DOC_AUDIENCES, DOC_STATUSES,
  docTypeLabel, docAudienceLabel, docStatusLabel,
  computeHealth, DOC_HEALTH_LABELS,
} from "@/lib/doc-types";
import { formatDistanceToNow, parseISO } from "date-fns";

export interface ClientOption { id: string; name: string; }

export interface DrawerDoc {
  id: number;
  name: string;
  path: string;
  doc_type: string;
  status: string;
  audience: string;
  client_id: string | null;
  description: string | null;
  chunk_count: number | null;
  last_indexed_at: string | null;
  updated_at?: string;
  storage_path: string | null;
}

export interface MetadataDrawerProps {
  doc: DrawerDoc;
  clients: ClientOption[];
  onClose: () => void;
  onSaved: (updated: DrawerDoc) => void;
}

export default function MetadataDrawer({ doc, clients, onClose, onSaved }: MetadataDrawerProps) {
  const [tab, setTab] = useState<"details" | "preview">("details");
  const [docType, setDocType] = useState(doc.doc_type);
  const [status, setStatus] = useState(doc.status);
  const [audience, setAudience] = useState(doc.audience);
  const [clientId, setClientId] = useState<string>(doc.client_id ?? "");
  const [description, setDescription] = useState(doc.description ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const health = computeHealth(doc);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const patch: Record<string, unknown> = {};
    if (docType !== doc.doc_type) patch.doc_type = docType;
    if (status !== doc.status) patch.status = status;
    if (audience !== doc.audience) patch.audience = audience;
    if ((clientId || null) !== doc.client_id) patch.client_id = clientId || null;
    if (description !== (doc.description ?? "")) patch.description = description || null;

    if (Object.keys(patch).length === 0) {
      setSaving(false);
      onClose();
      return;
    }

    try {
      const res = await fetch(`/api/docs/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ? JSON.stringify(data.error) : "Save failed");
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved({ ...doc, ...data });
    } catch {
      setSaveError("Network error saving changes");
      setSaving(false);
    }
  }

  return (
    <div className="w-[440px] flex-shrink-0 border-l border-brand-border h-full flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between flex-shrink-0">
        <p className="text-sm font-semibold text-brand-black truncate">{doc.name}</p>
        <button onClick={onClose} className="text-xs text-brand-muted hover:text-brand-black">Close</button>
      </div>

      <div className="flex border-b border-brand-border flex-shrink-0">
        {(["details", "preview"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "flex-1 text-xs font-medium py-2 border-b-2 transition-colors",
              tab === t ? "border-brand-orange text-brand-black" : "border-transparent text-brand-muted hover:text-brand-black"
            )}
          >
            {t === "details" ? "Details" : "Preview"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "preview" ? (
          <div className="text-xs text-brand-muted">
            <p><span className="font-semibold text-brand-black">Path:</span> {doc.path}</p>
            <p className="mt-2"><span className="font-semibold text-brand-black">Description:</span> {description || "—"}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Doc type</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange">
                {DOC_TYPES.map((t) => <option key={t} value={t}>{docTypeLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange">
                {DOC_STATUSES.map((s) => <option key={s} value={s}>{docStatusLabel(s)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value)}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange">
                {DOC_AUDIENCES.map((a) => <option key={a} value={a}>{docAudienceLabel(a)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">
                Client <span className="text-brand-muted normal-case">(future)</span>
              </label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange text-brand-muted">
                <option value="">Rosably (unassigned)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                className="w-full mt-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-orange resize-none" />
            </div>

            <div className="border-t border-brand-border pt-3">
              <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide mb-2">Index health</p>
              <div className="text-xs text-brand-black space-y-1">
                <p>Status: <span className="font-medium">{DOC_HEALTH_LABELS[health]}</span></p>
                <p>Chunks: {doc.chunk_count ?? "—"}</p>
                <p>Last indexed: {doc.last_indexed_at ? formatDistanceToNow(parseISO(doc.last_indexed_at), { addSuffix: true }) : "never"}</p>
                {doc.storage_path && <p>Storage path: <span className="font-mono text-[11px]">{doc.storage_path}</span></p>}
              </div>
            </div>

            {saveError && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{saveError}</div>}

            <button onClick={handleSave} disabled={saving}
              className={clsx(
                "w-full text-sm font-medium py-2 rounded-lg transition-colors",
                saving ? "bg-brand-offwhite text-brand-muted cursor-not-allowed" : "bg-brand-orange text-white hover:bg-brand-orange-dark"
              )}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
