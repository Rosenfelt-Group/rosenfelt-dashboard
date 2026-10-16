"use client";
import clsx from "clsx";
import { DiscoveryFieldDef, DiscoveryQuestionnaireDef } from "@/types";
import { allFields, dependentsOf } from "@/lib/discovery/snapshot";
import { moveAt, moveField, moveFieldToSection, removeField, uniqueSectionId } from "@/lib/discovery/editing";
import { TYPE_LABEL } from "./QuestionForm";

interface Props {
  def: DiscoveryQuestionnaireDef;
  onChange: (def: DiscoveryQuestionnaireDef) => void;
  onAddFromBank: (sectionId: string) => void;
  onAddCustom?: (sectionId: string) => void;
  onEditField?: (field: DiscoveryFieldDef) => void;
  /** Extra badges or controls on a question row. */
  fieldExtras?: (field: DiscoveryFieldDef) => React.ReactNode;
  readOnly?: boolean;
}

const ICON = "text-brand-muted hover:text-brand-black px-1.5 py-0.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed";

export function QuestionnaireOutline({ def, onChange, onAddFromBank, onAddCustom, onEditField, fieldExtras, readOnly }: Props) {
  const labelOf = (id: string) => allFields(def).find(f => f.id === id)?.label ?? id;

  function remove(f: DiscoveryFieldDef) {
    const deps = dependentsOf(def, f.id);
    const msg = deps.length
      ? `${deps.length === 1 ? "This question is" : `${deps.length} questions are`} only shown based on the answer to “${f.label}”:\n\n${deps.map(d => `• ${d.label}`).join("\n")}\n\nRemove it anyway? ${deps.length === 1 ? "That question" : "Those questions"} will then always be shown.`
      : null;
    if (msg && !confirm(msg)) return;
    onChange(removeField(def, f.id));
  }

  function setSection(i: number, patch: Partial<DiscoveryQuestionnaireDef["sections"][number]>) {
    onChange({ ...def, sections: def.sections.map((s, j) => j === i ? { ...s, ...patch } : s) });
  }

  function addSection() {
    const title = prompt("Section title");
    if (!title?.trim()) return;
    const id = uniqueSectionId(title, def.sections.map(s => s.id));
    onChange({ ...def, sections: [...def.sections, { id, title: title.trim(), fields: [] }] });
  }

  return (
    <div className="space-y-4">
      {!readOnly && !def.sections.some(s => s.fields.length) && (
        <p className="text-sm text-brand-muted">No questions yet — add from the bank or write your own.</p>
      )}
      {def.sections.map((s, si) => (
        <div key={s.id} className="card p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-brand-offwhite border-b border-brand-border">
            <span className="text-xs text-brand-muted w-5">{si + 1}.</span>
            {readOnly ? <h3 className="flex-1 text-sm font-semibold text-brand-black">{s.title}</h3> : (
              <input className="flex-1 bg-transparent text-sm font-semibold text-brand-black focus:outline-none focus:bg-white rounded px-1"
                value={s.title} onChange={e => setSection(si, { title: e.target.value })} aria-label="Section title" />
            )}
            {s.modules?.length ? <span className="badge badge-neutral text-xs">Only: {s.modules.join(", ")}</span> : null}
            {!readOnly && (
              <>
                <button className={ICON} disabled={si === 0} onClick={() => onChange({ ...def, sections: moveAt(def.sections, si, -1) })} aria-label="Move section up">↑</button>
                <button className={ICON} disabled={si === def.sections.length - 1} onClick={() => onChange({ ...def, sections: moveAt(def.sections, si, 1) })} aria-label="Move section down">↓</button>
                <button className={ICON} disabled={s.fields.length > 0} title={s.fields.length ? "Move or remove its questions first" : "Remove section"}
                  onClick={() => onChange({ ...def, sections: def.sections.filter((_, j) => j !== si) })} aria-label="Remove section">✕</button>
              </>
            )}
          </div>

          {s.fields.length === 0 && <p className="px-4 py-3 text-xs text-brand-muted">No questions in this section yet.</p>}
          {s.fields.map((f, fi) => (
            <div key={f.id} className="flex items-start gap-2 px-4 py-2.5 border-b border-brand-border last:border-b-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-brand-black">{f.label}{f.required && <span className="text-brand-orange ml-1" aria-label="required">*</span>}</p>
                <div className="flex flex-wrap gap-1 mt-1 items-center">
                  <span className="badge badge-neutral text-[10px]">{TYPE_LABEL[f.type] ?? f.type}</span>
                  {f.showIf && (
                    <span className="badge text-[10px] bg-blue-50 text-blue-700" title={JSON.stringify(f.showIf)}>
                      Shown if “{labelOf(f.showIf.field)}” {f.showIf.in ? `is ${f.showIf.in.join(" / ")}` : f.showIf.notIn ? `isn't ${f.showIf.notIn.join(" / ")}` : "is answered"}
                    </span>
                  )}
                  {f.type === "yes_no" && f.followUpOn && <span className="badge text-[10px] bg-amber-50 text-amber-700">Follow-up on {f.followUpOn}</span>}
                  {f.options?.length ? <span className="text-[11px] text-brand-muted truncate max-w-xs">{f.options.join(" · ")}</span> : null}
                  {fieldExtras?.(f)}
                </div>
              </div>
              {!readOnly && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button className={ICON} disabled={fi === 0} onClick={() => onChange(moveField(def, f.id, -1))} aria-label="Move up">↑</button>
                  <button className={ICON} disabled={fi === s.fields.length - 1} onClick={() => onChange(moveField(def, f.id, 1))} aria-label="Move down">↓</button>
                  {def.sections.length > 1 && (
                    <select className="text-xs text-brand-muted bg-transparent border-none w-6 cursor-pointer" value="" aria-label="Move to section"
                      onChange={e => e.target.value && onChange(moveFieldToSection(def, f.id, e.target.value))} title="Move to another section">
                      <option value="">⇄</option>
                      {def.sections.filter(o => o.id !== s.id).map(o => <option key={o.id} value={o.id}>Move to: {o.title}</option>)}
                    </select>
                  )}
                  {onEditField && <button className={ICON} onClick={() => onEditField(f)}>Edit</button>}
                  <button className={clsx(ICON, "hover:text-red-600")} onClick={() => remove(f)} aria-label="Remove question">✕</button>
                </div>
              )}
            </div>
          ))}

          {!readOnly && (
            <div className="flex gap-3 px-4 py-2 border-t border-brand-border bg-white">
              <button className="text-xs text-brand-orange font-medium" onClick={() => onAddFromBank(s.id)}>+ From bank</button>
              {onAddCustom && <button className="text-xs text-brand-orange font-medium" onClick={() => onAddCustom(s.id)}>+ Custom question</button>}
            </div>
          )}
        </div>
      ))}
      {!readOnly && <button className="btn-ghost text-xs" onClick={addSection}>+ Add section</button>}
    </div>
  );
}
