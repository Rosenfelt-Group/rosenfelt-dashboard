"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import clsx from "clsx";
import { CRMNav } from "@/components/CRMNav";
import { DiscoveryNav } from "@/components/crm/discovery/DiscoveryNav";
import { INPUT, LABEL } from "@/components/crm/discovery/QuestionForm";
import { QuestionnaireOutline } from "@/components/crm/discovery/QuestionnaireOutline";
import { BankPicker } from "@/components/crm/discovery/BankPicker";
import { DiscoveryProjectType, DiscoveryQuestion, DiscoveryQuestionnaireDef, DiscoveryTemplate, DiscoveryTemplateItem } from "@/types";
import { addFields } from "@/lib/discovery/editing";
import { dropDanglingShowIf, questionToField } from "@/lib/discovery/snapshot";
import { PROJECT_TYPES } from "@/lib/discovery";

type Loaded = Omit<DiscoveryTemplate, "items"> & { items: (DiscoveryTemplateItem & { question: DiscoveryQuestion })[] };
// Per-question template settings that aren't part of the rendered field.
type Meta = { question: DiscoveryQuestion; required: boolean | null; project_types: DiscoveryProjectType[] | null };

function toEditor(t: Loaded) {
  const meta: Record<string, Meta> = {};
  const def: DiscoveryQuestionnaireDef = {
    version: "template", title: t.name,
    sections: t.sections.map(s => ({
      id: s.id, title: s.title, ...(s.intro ? { intro: s.intro } : {}),
      fields: t.items.filter(i => i.section_id === s.id && i.question).map(i => {
        meta[i.question.key] = { question: i.question, required: i.required ?? null, project_types: i.project_types ?? null };
        return questionToField(i.question, i);
      }),
    })),
  };
  return { def, meta };
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [tpl, setTpl] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", description: "", intro_text: "", estimated_minutes: "" });
  const [def, setDef] = useState<DiscoveryQuestionnaireDef | null>(null);
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const apply = useCallback((t: Loaded) => {
    setTpl(t);
    setForm({ name: t.name, description: t.description ?? "", intro_text: t.intro_text ?? "", estimated_minutes: t.estimated_minutes ? String(t.estimated_minutes) : "" });
    const e = toEditor(t);
    setDef(e.def); setMeta(e.meta); setDirty(false);
  }, []);

  useEffect(() => {
    fetch(`/api/crm/discovery/templates/${id}`).then(r => r.json()).then(d => { if (d?.id) apply(d); setLoading(false); });
  }, [id, apply]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const edit = (d: DiscoveryQuestionnaireDef) => { setDef(d); setDirty(true); setSaved(false); };
  const setF = (patch: Partial<typeof form>) => { setForm(f => ({ ...f, ...patch })); setDirty(true); setSaved(false); };

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label); setError("");
    const res = await fetch(`/api/crm/discovery/templates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setError(data.error ?? "Could not save"); return false; }
    apply(data);
    return true;
  }

  async function save() {
    if (!def) return;
    const clean = dropDanglingShowIf(def);
    const items = clean.sections.flatMap(s => s.fields.map(f => ({
      question_id: meta[f.id].question.id,
      section_id: s.id,
      required: meta[f.id].required,
      project_types: meta[f.id].project_types,
      show_if: f.showIf ?? null,
    })));
    const ok = await patch({
      name: form.name,
      description: form.description || null,
      intro_text: form.intro_text || null,
      estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
      sections: clean.sections.map(s => ({ id: s.id, title: s.title.trim() || "Untitled", ...(s.intro ? { intro: s.intro } : {}) })),
      items,
    }, "save");
    if (ok) setSaved(true);
  }

  function addFromBank(qs: DiscoveryQuestion[], sectionId: string) {
    if (!def) return;
    setMeta(m => ({ ...m, ...Object.fromEntries(qs.map(q => [q.key, { question: q, required: null, project_types: null }])) }));
    edit(addFields(def, sectionId, qs.map(q => questionToField(q))));
    setPicker(null);
  }

  function setRequired(key: string, value: boolean | null) {
    if (!def) return;
    const m = meta[key];
    setMeta(prev => ({ ...prev, [key]: { ...m, required: value } }));
    const effective = value ?? m.question.required;
    edit({ ...def, sections: def.sections.map(s => ({ ...s, fields: s.fields.map(f => {
      if (f.id !== key) return f;
      const { required: _r, ...rest } = f;
      return effective ? { ...rest, required: true } : rest;
    }) })) });
  }

  if (loading) return <div className="p-8"><div className="card animate-pulse h-64" /></div>;
  if (!tpl || !def) {
    return (
      <div className="p-8">
        <p className="text-brand-muted">Template not found.</p>
        <Link href="/crm/discovery/templates" className="text-brand-orange text-sm mt-2 block">← Templates</Link>
      </div>
    );
  }

  const count = def.sections.reduce((n, s) => n + s.fields.length, 0);

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <CRMNav />
      <DiscoveryNav />
      <Link href="/crm/discovery/templates" className="text-xs text-brand-muted hover:text-brand-black">← Templates</Link>

      <div className="card mt-2 mb-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-semibold text-brand-black flex-1">{tpl.name}</h1>
          {tpl.is_default && <span className="badge badge-success">Default</span>}
          {tpl.archived_at && <span className="badge badge-neutral">Archived</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-3">
            <label className={LABEL}>Name *</label>
            <input className={INPUT} value={form.name} onChange={e => setF({ name: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Minutes to complete</label>
            <input type="number" min={1} max={120} className={INPUT} value={form.estimated_minutes} placeholder="Auto"
              onChange={e => setF({ estimated_minutes: e.target.value })} />
          </div>
          <div className="md:col-span-4">
            <label className={LABEL}>Description (internal)</label>
            <input className={INPUT} value={form.description} onChange={e => setF({ description: e.target.value })} />
          </div>
          <div className="md:col-span-4">
            <label className={LABEL}>Intro text (welcome screen; editable per prospect)</label>
            <textarea className={clsx(INPUT, "h-24")} value={form.intro_text} onChange={e => setF({ intro_text: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-brand-muted">
          Editing a template only affects questionnaires created from it afterwards. Sent questionnaires never change.
        </p>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-brand-black">{count} question{count === 1 ? "" : "s"}</h2>
      </div>

      <QuestionnaireOutline
        def={def}
        onChange={edit}
        onAddFromBank={setPicker}
        fieldExtras={f => {
          const m = meta[f.id];
          if (!m) return null;
          return (
            <>
              {m.project_types?.length ? (
                <span className="badge text-[10px] bg-purple-50 text-purple-700">
                  Only for: {m.project_types.map(p => PROJECT_TYPES.find(t => t.value === p)?.label ?? p).join(", ")}
                </span>
              ) : null}
              <select className="text-[11px] text-brand-muted bg-transparent border border-brand-border rounded px-1"
                value={m.required === null ? "" : m.required ? "yes" : "no"} aria-label="Required"
                onChange={e => setRequired(f.id, e.target.value === "" ? null : e.target.value === "yes")}>
                <option value="">{m.question.required ? "Required (bank)" : "Optional (bank)"}</option>
                <option value="yes">Required here</option>
                <option value="no">Optional here</option>
              </select>
            </>
          );
        }}
      />

      <div className="sticky bottom-0 md:bottom-4 mt-6 card flex items-center gap-2 flex-wrap shadow-lg">
        <button onClick={save} disabled={!dirty || !!busy || !form.name.trim()} className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
          {busy === "save" ? "Saving…" : "Save template"}
        </button>
        {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : saved ? <span className="text-xs text-green-700">Saved</span> : null}
        {error && <span className="text-xs text-red-600">{error}</span>}
        <div className="ml-auto flex gap-2">
          {!tpl.is_default && !tpl.archived_at && (
            <button onClick={() => patch({ is_default: true }, "default")} disabled={!!busy || dirty} className="btn-ghost text-xs px-3 py-1.5">Make default</button>
          )}
          {!tpl.is_default && (
            <button onClick={() => patch({ archived: !tpl.archived_at }, "archive")} disabled={!!busy || dirty} className="btn-ghost text-xs px-3 py-1.5">
              {tpl.archived_at ? "Unarchive" : "Archive"}
            </button>
          )}
        </div>
      </div>

      {picker && (
        <BankPicker
          excludeKeys={new Set(Object.keys(meta).filter(k => def.sections.some(s => s.fields.some(f => f.id === k))))}
          sections={def.sections}
          defaultSectionId={picker}
          onAdd={addFromBank}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
