"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { DiscoveryFieldDef, DiscoveryInvite, DiscoveryProjectType, DiscoveryQuestion, DiscoveryQuestionnaireDef, DiscoveryTemplate } from "@/types";
import { PROJECT_TYPES } from "@/lib/discovery";
import { allFields, customKey, estimateMinutes, questionToField, DraftSnapshotSchema } from "@/lib/discovery/snapshot";
import { addFields, uniqueSectionId, updateField } from "@/lib/discovery/editing";
import { CopyButton } from "@/components/crm/CopyButton";
import { inviteEmail } from "@/lib/discovery/invite-email";
import { BankPicker } from "./BankPicker";
import { QuestionnaireOutline } from "./QuestionnaireOutline";
import { DeleteDiscoveryButton } from "./DeleteDiscoveryButton";
import { RecipientFields, useEmailConfigured } from "./EmailInvite";
import { EMPTY_QUESTION, INPUT, LABEL, QuestionDraft, QuestionForm } from "./QuestionForm";
import { fetchJson } from "@/lib/fetch-json";
import { Button, Modal } from "@/components/ui";

type Detail = DiscoveryInvite & { link: string };

const NON_CONFIG = new Set(["id", "type", "label", "help", "required", "options", "showIf"]);

function fieldToDraft(f: DiscoveryFieldDef, section: string): QuestionDraft {
  const config = Object.fromEntries(Object.entries(f).filter(([k]) => !NON_CONFIG.has(k)));
  return { label: f.label, help: f.help ?? "", type: f.type, required: !!f.required, options: f.options ?? [], config, section };
}

function draftToField(d: QuestionDraft, id: string, showIf?: DiscoveryFieldDef["showIf"]): DiscoveryFieldDef {
  const config = Object.fromEntries(Object.entries(d.config).filter(([, v]) => v !== undefined && v !== ""));
  const f: DiscoveryFieldDef = { ...config, id, type: d.type, label: d.label };
  if (d.help) f.help = d.help;
  if (d.required) f.required = true;
  if (d.options.length) f.options = d.options;
  if (d.type === "scale") { f.min ??= 1; f.max ??= 5; }
  if (showIf) f.showIf = showIf;
  return f;
}

/** Section id for a section title, creating the section if needed. */
function ensureSection(def: DiscoveryQuestionnaireDef, title: string): [DiscoveryQuestionnaireDef, string] {
  const hit = def.sections.find(s => s.title.trim().toLowerCase() === title.trim().toLowerCase());
  if (hit) return [def, hit.id];
  const id = uniqueSectionId(title, def.sections.map(s => s.id));
  return [{ ...def, sections: [...def.sections, { id, title: title.trim(), fields: [] }] }, id];
}

export function DraftEditor({ invite, onChanged }: { invite: Detail; onChanged: (d: Detail | null) => void }) {
  const [def, setDef] = useState<DiscoveryQuestionnaireDef>(invite.questionnaire_snapshot ?? { version: "draft", title: "Discovery questionnaire", sections: [] });
  const [project, setProject] = useState({ title: invite.project_title, brief: invite.project_brief ?? "", type: invite.project_type });
  const [templates, setTemplates] = useState<DiscoveryTemplate[]>([]);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [custom, setCustom] = useState<{ sectionId: string } | null>(null);
  const [saveToBank, setSaveToBank] = useState(false);
  const [editing, setEditing] = useState<DiscoveryFieldDef | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ link: string; email: string; emailed?: { ok: boolean; text: string } } | null>(null);
  const emailConfigured = useEmailConfigured();
  const [recipient, setRecipient] = useState({ to: invite.contact?.email ?? "", firstName: invite.contact?.first_name ?? "" });

  const [templatesError, setTemplatesError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<unknown>("/api/crm/discovery/templates").then(r => {
      if (r.ok) setTemplates(Array.isArray(r.data) ? r.data : []);
      else setTemplatesError(r.error);
    });
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const edit = (d: DiscoveryQuestionnaireDef) => { setDef(d); setDirty(true); setError(""); };
  const sectionTitles = def.sections.map(s => s.title);
  const keys = new Set(allFields(def).map(f => f.id));
  const minutes = def.estimated_minutes ?? estimateMinutes(def);
  const contactFirst = invite.contact?.first_name;

  async function patch(body: Record<string, unknown>, label: string): Promise<Detail | null> {
    setBusy(label); setError("");
    const res = await fetch(`/api/crm/discovery/${invite.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setError(data.error ?? "Could not save"); return null; }
    return data as Detail;
  }

  async function save(label = "save"): Promise<boolean> {
    const check = DraftSnapshotSchema.safeParse(def);
    if (!check.success) { setError(check.error.issues[0]?.message ?? "The questionnaire is incomplete"); return false; }
    const d = await patch({
      questionnaire_snapshot: def,
      project_title: project.title,
      project_brief: project.brief || null,
      project_type: project.type,
    }, label);
    if (!d) return false;
    setDirty(false);
    onChanged(d);
    return true;
  }

  async function rebuild(templateId: string) {
    const name = templates.find(t => t.id === templateId)?.name ?? "this template";
    if (!confirm(`Replace the questions with “${name}”? Your edits to this draft will be lost.`)) return;
    const d = await patch({ rebuild_from_template: templateId, project_type: project.type }, "rebuild");
    if (d?.questionnaire_snapshot) { setDef(d.questionnaire_snapshot); setDirty(false); onChanged(d); }
  }

  async function preview() {
    // Open the window synchronously so popup blockers allow it, then point it at the saved draft.
    const w = window.open("about:blank", "_blank");
    if (dirty && !(await save("preview"))) { w?.close(); return; }
    if (w) { w.opener = null; w.location.href = `${invite.link}&preview=1`; }
  }

  async function send(withEmail: boolean) {
    const to = recipient.to.trim();
    if (withEmail && !to) { setError("Enter the recipient's email"); return; }
    const prompt = withEmail ? `Send this questionnaire and email it to ${to}?` : "Send this questionnaire?";
    if (!confirm(`${prompt} Its questions are frozen once sent.`)) return;
    if (dirty && !(await save("send"))) return;
    setBusy(withEmail ? "send-email" : "send"); setError("");
    const firstName = recipient.firstName.trim() || undefined;
    const res = await fetch(`/api/crm/discovery/${invite.id}/send`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(withEmail ? { email: { to, firstName } } : {}),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setError(data.error ?? "Could not send"); return; }
    setSent({
      link: data.link,
      email: inviteEmail({ firstName: withEmail ? firstName : contactFirst, orgName: invite.business?.name, projectTitle: project.title, link: data.link, minutes }),
      emailed: data.email ? (data.email.sent ? { ok: true, text: `Emailed to ${to}.` } : { ok: false, text: `Sent, but the email failed: ${data.email.error}` }) : undefined,
    });
  }

  async function draftWithRiley() {
    if (dirty) return;
    setBusy("riley"); setError("");
    const res = await fetch(`/api/crm/discovery/${invite.id}/draft-questionnaire`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(""); setError(data.error ?? "Riley could not draft the questionnaire"); return; }
    // Riley wrote the new snapshot server-side: reload the invite so the editor shows it.
    const r = await fetchJson<Detail>(`/api/crm/discovery/${invite.id}`);
    setBusy("");
    if (!r.ok || !r.data.questionnaire_snapshot) { setError(r.ok ? "Riley's draft is saved, but could not be shown. Reload the page." : r.error); return; }
    setDef(r.data.questionnaire_snapshot);
    setDirty(false);
    onChanged(r.data);
  }

  function addFromBank(qs: DiscoveryQuestion[], sectionId: string) {
    edit(addFields(def, sectionId, qs.map(q => questionToField(q))));
    setPicker(null);
  }

  async function addCustom(q: QuestionDraft) {
    let id = customKey(q.label, keys);
    if (saveToBank) {
      setBusy("bank");
      const res = await fetch("/api/crm/discovery/questions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...q, help: q.help || null, options: q.options.length ? q.options : null }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy("");
      if (!res.ok) { setError(data.error ?? "Could not save to the bank"); return; }
      id = keys.has(data.key) ? customKey(q.label, keys) : data.key;
    }
    const [withSection, sectionId] = ensureSection(def, q.section);
    edit(addFields(withSection, sectionId, [draftToField(q, id)]));
    setCustom(null);
  }

  function saveEdit(q: QuestionDraft) {
    if (!editing) return;
    const field = draftToField(q, editing.id, editing.showIf);
    let next = updateField(def, editing.id, () => field);
    const current = def.sections.find(s => s.fields.some(f => f.id === editing.id));
    if (current && current.title.trim().toLowerCase() !== q.section.trim().toLowerCase()) {
      const [withSection, sectionId] = ensureSection(next, q.section);
      next = {
        ...withSection,
        sections: withSection.sections.map(s => ({
          ...s,
          fields: s.id === sectionId ? [...s.fields, field] : s.fields.filter(f => f.id !== editing.id),
        })),
      };
    }
    edit(next);
    setEditing(null);
  }

  if (sent) {
    return (
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-brand-black">Questionnaire sent</h2>
        {sent.emailed && (
          <p className={clsx("text-sm", sent.emailed.ok ? "text-green-700" : "text-amber-700")}>{sent.emailed.text}</p>
        )}
        <p className="text-sm text-brand-muted">
          The questions are frozen. {sent.emailed?.ok ? "The link, if you need it again:" : `Send the link to ${contactFirst || "the contact"}:`}
        </p>
        <div className="flex gap-2">
          <input readOnly className={clsx(INPUT, "bg-brand-offwhite")} value={sent.link} onFocus={e => e.target.select()} />
          <CopyButton text={sent.link} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-brand-muted">Invite email</label>
            <CopyButton text={sent.email} label="Copy email" />
          </div>
          <textarea readOnly className={clsx(INPUT, "h-56 bg-brand-offwhite")} value={sent.email} />
        </div>
        <Button onClick={() => onChanged({ ...invite, status: "sent" })}>Done</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="card mb-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-brand-black">Customize before sending</h2>
            <p className="text-xs text-brand-muted mt-0.5">
              {def.template ? <>From template <Link href={`/crm/discovery/templates/${def.template.id}`} className="text-brand-orange">{def.template.name}</Link> · </> : null}
              {keys.size} questions · about {minutes} min · only you can see this draft
            </p>
          </div>
          <select className="border border-brand-border rounded-lg px-2 py-1.5 text-xs" value="" disabled={!!busy}
            onChange={e => e.target.value && rebuild(e.target.value)} aria-label="Start over from a template">
            <option value="">Start over from a template…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>)}
          </select>
        </div>
        {templatesError && <p role="alert" className="text-xs text-red-600">Couldn&apos;t load templates: {templatesError}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className={LABEL}>Project title *</label>
            <input className={INPUT} value={project.title} onChange={e => { setProject({ ...project, title: e.target.value }); setDirty(true); }} />
          </div>
          <div>
            <label className={LABEL}>Project type</label>
            <select className={INPUT} value={project.type} onChange={e => { setProject({ ...project, type: e.target.value as DiscoveryProjectType }); setDirty(true); }}>
              {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {project.type !== invite.project_type && (
              <p className="text-xs text-amber-700 mt-1">Workflow questions don&apos;t change on their own — use “Start over from a template” to rebuild for this type.</p>
            )}
          </div>
          <div className="md:col-span-3">
            <label className={LABEL}>Project description (shown with the first section)</label>
            <textarea className={clsx(INPUT, "h-20")} value={project.brief} onChange={e => { setProject({ ...project, brief: e.target.value }); setDirty(true); }} />
          </div>
          <div className="md:col-span-3">
            <label className={LABEL}>Intro text (welcome screen)</label>
            <textarea className={clsx(INPUT, "h-24")} value={def.intro ?? ""}
              placeholder="Leave empty for the standard welcome text."
              onChange={e => edit({ ...def, intro: e.target.value || undefined })} />
          </div>
        </div>
      </div>

      <QuestionnaireOutline
        def={def}
        onChange={edit}
        onAddFromBank={setPicker}
        onAddCustom={sectionId => { setSaveToBank(false); setCustom({ sectionId }); }}
        onEditField={setEditing}
      />

      {emailConfigured && (
        <div className="card mt-6 space-y-2">
          <h2 className="text-sm font-semibold text-brand-black">Email the invite</h2>
          <p className="text-xs text-brand-muted">Sent from brian@rosably.com with the same text as the copied invite email.</p>
          <RecipientFields to={recipient.to} firstName={recipient.firstName} onChange={setRecipient} />
        </div>
      )}

      <div className="sticky bottom-0 md:bottom-4 mt-6 card flex items-center gap-2 flex-wrap shadow-lg">
        <Button variant="ghost" onClick={() => save()} disabled={!dirty || !!busy || !project.title.trim()}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </Button>
        <Button variant="ghost" onClick={preview} disabled={!!busy}>{busy === "preview" ? "Saving…" : "Preview ↗"}</Button>
        <Button variant="ghost" onClick={draftWithRiley} disabled={!!busy || dirty}
          title={dirty ? "Save first" : "Riley rewrites this draft's questions"}>
          {busy === "riley" ? "Riley is drafting…" : "Draft with Riley"}
        </Button>
        {dirty && !busy && <span className="text-xs text-brand-muted">Save first</span>}
        {emailConfigured ? (
          <>
            <Button onClick={() => send(true)} disabled={!!busy || !keys.size || !project.title.trim() || !recipient.to.trim()}>
              {busy === "send-email" ? "Sending…" : "Send & email"}
            </Button>
            <Button variant="ghost" onClick={() => send(false)} disabled={!!busy || !keys.size || !project.title.trim()}>
              {busy === "send" ? "Sending…" : "Send (copy link only)"}
            </Button>
          </>
        ) : (
          <Button onClick={() => send(false)} disabled={!!busy || !keys.size || !project.title.trim()}>
            {busy === "send" ? "Sending…" : "Send"}
          </Button>
        )}
        {!keys.size && <span className="text-xs text-brand-muted">Add at least one question to send.</span>}
        {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
        <span className="ml-auto flex items-center gap-2">
          <DeleteDiscoveryButton inviteId={invite.id} status="draft" hasResponse={false} disabled={!!busy} onDeleted={() => onChanged(null)} />
        </span>
      </div>

      {picker && (
        <BankPicker excludeKeys={keys} sections={def.sections} defaultSectionId={picker} onAdd={addFromBank} onClose={() => setPicker(null)} />
      )}

      {custom && (
        <Modal open size="lg" title="Custom question" onClose={() => setCustom(null)}>
          <QuestionForm
            initial={{ ...EMPTY_QUESTION, section: def.sections.find(s => s.id === custom.sectionId)?.title ?? "" }}
            sections={sectionTitles}
            submitLabel="Add question"
            busy={busy === "bank"}
            error={error}
            footer={
              <label className="flex items-center gap-2 text-sm text-brand-black">
                <input type="checkbox" checked={saveToBank} onChange={e => setSaveToBank(e.target.checked)} />
                Also save to the question bank
              </label>
            }
            onSubmit={addCustom}
            onCancel={() => setCustom(null)}
          />
        </Modal>
      )}

      {editing && (
        <Modal open size="lg" title="Edit question (this draft only)" onClose={() => setEditing(null)}>
          <p className="text-xs text-brand-muted mb-4">Changes apply to this prospect only. The bank and templates are unchanged.</p>
          <QuestionForm
            initial={fieldToDraft(editing, def.sections.find(s => s.fields.some(f => f.id === editing.id))?.title ?? "")}
            sections={sectionTitles}
            submitLabel="Update"
            onSubmit={saveEdit}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
