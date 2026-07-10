"use client";
import { useState } from "react";
import clsx from "clsx";
import { DOC_TYPES, DOC_AUDIENCES, DOC_STATUSES, docTypeLabel, docAudienceLabel, docStatusLabel } from "@/lib/doc-types";

export interface ClientOption { id: string; name: string; }

export interface BulkActionBarProps {
  selectedIds: number[];
  clients: ClientOption[];
  onClear: () => void;
  onApplied: () => void;
}

type Field = "doc_type" | "status" | "audience" | "client_id";

export default function BulkActionBar({ selectedIds, clients, onClear, onApplied }: BulkActionBarProps) {
  const [field, setField] = useState<Field>("status");
  const [value, setValue] = useState<string>("active");
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function apply(patch: Record<string, string | null>) {
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/docs/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ? JSON.stringify(data.error) : "Bulk update failed");
        return;
      }
      setMessage(`Updated ${data.updated} document${data.updated === 1 ? "" : "s"}`);
      // Delay onApplied (which the parent uses to clear selection, unmounting
      // this bar) until the message has actually been visible for a beat —
      // calling it immediately batched with setMessage above and unmounted
      // this component before the toast ever painted.
      setTimeout(() => {
        setMessage(null);
        onApplied();
      }, 3000);
    } catch {
      setMessage("Network error applying bulk update");
    } finally {
      setApplying(false);
    }
  }

  const fieldOptions: Record<Field, string[]> = {
    doc_type: DOC_TYPES,
    status: DOC_STATUSES,
    audience: DOC_AUDIENCES,
    client_id: ["", ...clients.map((c) => c.id)],
  };
  const labelFor = (f: Field, v: string) =>
    f === "doc_type" ? docTypeLabel(v) :
    f === "status" ? docStatusLabel(v) :
    f === "audience" ? docAudienceLabel(v) :
    v === "" ? "Rosably (unassigned)" : clients.find((c) => c.id === v)?.name ?? v;

  function handleFieldChange(next: Field) {
    setField(next);
    setValue(fieldOptions[next][0] ?? "");
  }

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-brand-black text-white px-4 py-2.5 rounded-lg mb-3 flex-wrap">
      <span className="text-xs font-medium">{selectedIds.length} selected</span>

      <select value={field} onChange={(e) => handleFieldChange(e.target.value as Field)}
        className="text-xs bg-white text-brand-black rounded px-2 py-1">
        <option value="status">Status</option>
        <option value="doc_type">Doc type</option>
        <option value="audience">Audience</option>
        <option value="client_id">Client (future)</option>
      </select>

      <select value={value} onChange={(e) => setValue(e.target.value)}
        className="text-xs bg-white text-brand-black rounded px-2 py-1">
        {fieldOptions[field].map((v) => <option key={v || "unassigned"} value={v}>{labelFor(field, v)}</option>)}
      </select>

      <button
        onClick={() => apply({ [field]: field === "client_id" ? (value || null) : value })}
        disabled={applying}
        className="text-xs font-medium px-3 py-1 rounded bg-brand-orange hover:bg-brand-orange-dark disabled:opacity-50"
      >
        Apply
      </button>

      <button
        onClick={() => apply({ status: "archived" })}
        disabled={applying}
        className="text-xs font-medium px-3 py-1 rounded border border-white/30 hover:bg-white/10 disabled:opacity-50"
      >
        Archive
      </button>

      {message && <span className="text-xs text-white/80">{message}</span>}

      <button onClick={onClear} className={clsx("ml-auto text-xs text-white/70 hover:text-white")}>
        Clear selection
      </button>
    </div>
  );
}
