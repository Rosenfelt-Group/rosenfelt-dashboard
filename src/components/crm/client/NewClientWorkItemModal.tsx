"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";

/** Rendered only while open: the parent mounts it, so form state resets each time. */
export function NewClientWorkItemModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Modal focuses its first focusable (the close button) on open; this effect
  // runs after it, so the title field keeps the focus it had before.
  useEffect(() => { titleRef.current?.focus(); }, []);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          work_type: "deliverable",
          priority,
          status: "open",
          work_item_type: "client",
          client_id: clientId,
        }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New client work item"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Create"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Description (optional)"
          className="w-full rounded border border-brand-border px-2 py-1.5 text-xs"
        />
        <div>
          <div className="text-[10px] uppercase text-brand-muted mb-1">Priority</div>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as "high" | "medium" | "low")}
            className="w-full rounded border border-brand-border px-2 py-1 text-xs"
          >
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </div>
        <p className="text-[11px] text-brand-muted">
          Pre-filled: work_type=deliverable, work_item_type=client, client_id={clientId.slice(0, 8)}…
        </p>
        {err && <div className="text-xs text-red-700">{err}</div>}
      </div>
    </Modal>
  );
}
