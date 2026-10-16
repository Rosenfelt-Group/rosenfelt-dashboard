"use client";
import { useState } from "react";
import clsx from "clsx";
import { DiscoveryQuestionType } from "@/types";
import { QUESTION_TYPES, CHOICE_TYPES } from "@/lib/discovery/snapshot";
import { QuestionInput } from "@/lib/discovery/bank";

export const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";
export const LABEL = "text-xs text-brand-muted mb-1 block";

export type QuestionDraft = Pick<QuestionInput, "label" | "type" | "required" | "config"> & {
  help: string;
  options: string[];
  section: string;
};

export const EMPTY_QUESTION: QuestionDraft = { label: "", help: "", type: "textarea", required: false, options: [], config: {}, section: "" };

const LEGACY: DiscoveryQuestionType[] = ["email", "tool_rows"];

interface Props {
  initial: QuestionDraft;
  /** Section names to suggest (bank sections, or the draft's section titles). */
  sections: string[];
  sectionLabel?: string;
  submitLabel: string;
  /** Extra controls under the form, e.g. "save to bank". */
  footer?: React.ReactNode;
  busy?: boolean;
  error?: string;
  onSubmit: (q: QuestionDraft) => void;
  onCancel: () => void;
}

export function QuestionForm({ initial, sections, sectionLabel = "Section", submitLabel, footer, busy, error, onSubmit, onCancel }: Props) {
  const [q, setQ] = useState<QuestionDraft>(initial);
  const [optionsText, setOptionsText] = useState(initial.options.join("\n"));
  const set = (patch: Partial<QuestionDraft>) => setQ(prev => ({ ...prev, ...patch }));
  const setConfig = (patch: Record<string, unknown>) => setQ(prev => ({ ...prev, config: { ...prev.config, ...patch } }));
  const legacy = LEGACY.includes(q.type);
  const isChoice = CHOICE_TYPES.has(q.type);
  const options = optionsText.split("\n").map(o => o.trim()).filter(Boolean);
  const valid = q.label.trim() && q.section.trim() && (!isChoice || options.length > 0);

  function submit() {
    if (!valid) return;
    onSubmit({ ...q, label: q.label.trim(), help: q.help.trim(), section: q.section.trim(), options: isChoice ? options : [] });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL}>Question *</label>
        <textarea className={clsx(INPUT, "h-20")} value={q.label} onChange={e => set({ label: e.target.value })} autoFocus />
      </div>
      <div>
        <label className={LABEL}>Help text</label>
        <input className={INPUT} value={q.help} onChange={e => set({ help: e.target.value })} placeholder="Optional hint shown under the question" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL}>Type</label>
          <select className={INPUT} value={q.type} disabled={legacy} onChange={e => set({ type: e.target.value as DiscoveryQuestionType })}>
            {QUESTION_TYPES.filter(t => t.creatable || t.value === q.type).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>{sectionLabel} *</label>
          <input className={INPUT} value={q.section} onChange={e => set({ section: e.target.value })} list="question-form-sections" />
          <datalist id="question-form-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
        </div>
      </div>

      {isChoice && (
        <div>
          <label className={LABEL}>Options * (one per line)</label>
          <textarea className={clsx(INPUT, "h-28 font-mono text-xs")} value={optionsText} onChange={e => setOptionsText(e.target.value)} />
          <div className="flex gap-4 mt-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-brand-black">
              <input type="checkbox" checked={!!q.config.other} onChange={e => setConfig({ other: e.target.checked || undefined })} />
              Add an “Other” choice with a text box
            </label>
            {q.type === "multi" && (
              <label className="flex items-center gap-2 text-xs text-brand-black">
                Max picks
                <input type="number" min={1} max={40} className="w-16 border border-brand-border rounded px-2 py-1 text-xs"
                  value={(q.config.max as number | undefined) ?? ""} onChange={e => setConfig({ max: e.target.value ? Number(e.target.value) : undefined })} />
              </label>
            )}
          </div>
        </div>
      )}

      {q.type === "scale" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL}>Label for 1</label>
            <input className={INPUT} value={(q.config.minLabel as string | undefined) ?? ""} onChange={e => setConfig({ minLabel: e.target.value || undefined })} />
          </div>
          <div>
            <label className={LABEL}>Label for 5</label>
            <input className={INPUT} value={(q.config.maxLabel as string | undefined) ?? ""} onChange={e => setConfig({ maxLabel: e.target.value || undefined })} />
          </div>
        </div>
      )}

      {q.type === "yes_no" && (
        <div>
          <label className="flex items-center gap-2 text-xs text-brand-black mb-2">
            <input type="checkbox" checked={!!q.config.followUpOn}
              onChange={e => setConfig(e.target.checked ? { followUpOn: "Yes", followUpLabel: q.config.followUpLabel ?? "Tell us more" } : { followUpOn: undefined, followUpLabel: undefined })} />
            Ask a follow-up when they answer
            <select className="border border-brand-border rounded px-1 py-0.5 text-xs" disabled={!q.config.followUpOn}
              value={(q.config.followUpOn as string | undefined) ?? "Yes"} onChange={e => setConfig({ followUpOn: e.target.value })}>
              <option>Yes</option><option>No</option>
            </select>
          </label>
          {!!q.config.followUpOn && (
            <input className={INPUT} value={(q.config.followUpLabel as string | undefined) ?? ""} onChange={e => setConfig({ followUpLabel: e.target.value })}
              placeholder="Follow-up question" />
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-brand-black">
        <input type="checkbox" checked={q.required} onChange={e => set({ required: e.target.checked })} />
        Required
      </label>

      {footer}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="btn-ghost flex-1">Cancel</button>
        <button onClick={submit} disabled={!valid || busy} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

/** Modal shell matching NewDiscoveryModal. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
      <div className={clsx("bg-white rounded-xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto", wide ? "max-w-2xl" : "max-w-lg")}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-brand-black">{title}</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(QUESTION_TYPES.map(t => [t.value, t.label]));
