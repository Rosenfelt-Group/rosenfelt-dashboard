"use client";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { DiscoveryQuestion } from "@/types";
import { questionSearchText } from "@/lib/discovery/bank";
import { INPUT, LABEL, Modal, TYPE_LABEL } from "./QuestionForm";

interface Props {
  /** Bank keys already in the questionnaire; shown but not selectable. */
  excludeKeys: Set<string>;
  sections: { id: string; title: string }[];
  defaultSectionId?: string;
  onAdd: (questions: DiscoveryQuestion[], sectionId: string) => void;
  onClose: () => void;
}

export function BankPicker({ excludeKeys, sections, defaultSectionId, onAdd, onClose }: Props) {
  const [bank, setBank] = useState<DiscoveryQuestion[] | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [sectionId, setSectionId] = useState(defaultSectionId ?? sections[0]?.id ?? "");

  useEffect(() => {
    fetch("/api/crm/discovery/questions").then(r => r.json()).then(d => setBank(Array.isArray(d) ? d : []));
  }, []);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (bank ?? []).filter(q => !term || questionSearchText(q).includes(term));
  }, [bank, search]);

  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  return (
    <Modal title="Add from question bank" onClose={onClose} wide>
      <div className="space-y-3">
        <input className={INPUT} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        <div className="border border-brand-border rounded-lg max-h-[45vh] overflow-y-auto">
          {bank === null ? <div className="p-4 text-sm text-brand-muted">Loading…</div>
            : shown.length === 0 ? <div className="p-4 text-sm text-brand-muted">No questions match.</div>
            : shown.map(q => {
              const used = excludeKeys.has(q.key);
              const on = picked.includes(q.id);
              return (
                <label key={q.id} className={clsx("flex items-start gap-3 px-3 py-2 border-b border-brand-border last:border-b-0 text-sm",
                  used ? "opacity-40" : "cursor-pointer hover:bg-brand-offwhite", on && "bg-brand-offwhite")}>
                  <input type="checkbox" className="mt-1" disabled={used} checked={on} onChange={() => toggle(q.id)} />
                  <span className="flex-1 min-w-0">
                    <span className="text-brand-black">{q.label}</span>
                    <span className="block text-xs text-brand-muted">{q.section} · {TYPE_LABEL[q.type] ?? q.type}{used ? " · already added" : ""}</span>
                  </span>
                </label>
              );
            })}
        </div>
        <div>
          <label className={LABEL}>Add to section</label>
          <select className={INPUT} value={sectionId} onChange={e => setSectionId(e.target.value)}>
            {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button disabled={!picked.length || !sectionId} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => onAdd(picked.map(id => bank!.find(q => q.id === id)!).filter(Boolean), sectionId)}>
            Add {picked.length || ""} question{picked.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
