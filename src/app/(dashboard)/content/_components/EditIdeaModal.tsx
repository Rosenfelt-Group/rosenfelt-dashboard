"use client";
import { useState } from "react";
import { ContentIdea } from "@/types";
import { Button, Modal } from "@/components/ui";

const inputCls = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-orange/30 bg-white";

/** Mount only while editing: the form state is seeded from `idea` on mount. */
export function EditIdeaModal({ idea, onSave, onClose }: {
  idea: ContentIdea;
  onSave: (id: string, updates: Partial<ContentIdea>) => Promise<void>;
  onClose: () => void;
}) {
  const [title,       setTitle]       = useState(idea.title);
  const [description, setDescription] = useState(idea.description ?? "");
  const [priority,    setPriority]    = useState(idea.priority);
  const [signalType,  setSignalType]  = useState(idea.signal_type);
  const [source,      setSource]      = useState(idea.source ?? "");
  const [saving,      setSaving]      = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(idea.id, {
      title:       title.trim(),
      description: description.trim() || undefined,
      priority,
      signal_type: signalType,
      source:      source.trim() || undefined,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit idea"
      closeOnBackdrop
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            className={`${inputCls} resize-none`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value as ContentIdea["priority"])} className={inputCls}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Type</label>
            <select value={signalType} onChange={e => setSignalType(e.target.value as ContentIdea["signal_type"])} className={inputCls}>
              <option value="blog_topic">Blog topic</option>
              <option value="competitor_gap">Competitor gap</option>
              <option value="service_improvement">Service improvement</option>
              <option value="competitive_intel">Competitive intel</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Source</label>
          <input value={source} onChange={e => setSource(e.target.value)} className={inputCls}
            placeholder="e.g. Reddit, competitor site…" />
        </div>
      </div>
    </Modal>
  );
}
