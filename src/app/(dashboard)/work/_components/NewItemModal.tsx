"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { WORK_TYPES, PRIORITIES } from "@/components/work/work-constants";
import type { TaskPriority, WorkItemSource, WorkType } from "@/types";

// Phase 0.7: sources offered for manual creation. System-generated sources
// (backlog_migration / typeform / stripe) are intentionally omitted — they're
// only written by automated paths, never chosen by hand. Both build-plan
// origins collapse to one "From Plan Doc" choice writing source='sprint_plan'.
const CREATE_SOURCE_OPTIONS: { value: WorkItemSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "sprint_plan", label: "From Plan Doc" },
  { value: "agent_suggestion", label: "Suggested" },
  { value: "casey_audit", label: "Audit" },
];

export function NewItemModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workType, setWorkType] = useState<WorkType>("operations");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [source, setSource] = useState<WorkItemSource>("manual");
  // Phase 0.7: phase (sprint_number) is optional on ANY source, decoupled from it.
  const [sprintNumber, setSprintNumber] = useState<string>("");
  // Phase sub-step (text, e.g. "1.6") — optional, free text.
  const [phaseStep, setPhaseStep] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Modal focuses its first focusable element (the ✕ button) on open; move
  // focus to the title field afterwards, as the old autoFocus did.
  useEffect(() => {
    const id = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  async function save() {
    if (!title.trim()) return;
    setErr(null);

    // Phase is optional. If supplied it must be a positive number (decimals
    // allowed, e.g. 0.7, 1.0, 1.6 — matches the build plan's numbering).
    let sprintNumberParsed: number | null = null;
    const sprintRaw = sprintNumber.trim();
    if (sprintRaw) {
      const n = parseFloat(sprintRaw);
      if (!Number.isFinite(n) || n <= 0) {
        setErr("Phase must be a positive number (e.g. 0.7, 1.0), or left blank.");
        return;
      }
      sprintNumberParsed = n;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          work_type: workType,
          priority,
          status: "inbox",
          source,
          ...(sprintNumberParsed !== null && { sprint_number: sprintNumberParsed }),
          ...(phaseStep.trim() && { phase_step: phaseStep.trim() }),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 150)}`);
      }
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }


  return (
    <Modal
      open
      onClose={onClose}
      title="New work item"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!title.trim() || saving}>
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
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] uppercase text-brand-muted mb-1">Type</div>
            <select
              value={workType}
              onChange={(e) => setWorkType(e.target.value as WorkType)}
              className="w-full rounded border border-brand-border px-2 py-1 text-xs"
            >
              {WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] uppercase text-brand-muted mb-1">Priority</div>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full rounded border border-brand-border px-2 py-1 text-xs"
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] uppercase text-brand-muted mb-1">Source</div>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as WorkItemSource)}
              className="w-full rounded border border-brand-border px-2 py-1 text-xs"
            >
              {CREATE_SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[10px] uppercase text-brand-muted mb-1">
              Phase <span className="text-brand-muted normal-case">(optional)</span>
            </div>
            <input
              type="number"
              min={0}
              step="1"
              value={sprintNumber}
              onChange={(e) => setSprintNumber(e.target.value)}
              placeholder="e.g. 1"
              className="w-full rounded border border-brand-border px-2 py-1 text-xs"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase text-brand-muted mb-1">
              Step <span className="text-brand-muted normal-case">(optional)</span>
            </div>
            <input
              type="text"
              value={phaseStep}
              onChange={(e) => setPhaseStep(e.target.value)}
              placeholder="e.g. 1.6"
              className="w-full rounded border border-brand-border px-2 py-1 text-xs"
            />
          </div>
        </div>
        {err && <div className="text-xs text-red-700">{err}</div>}
      </div>
    </Modal>
  );
}
