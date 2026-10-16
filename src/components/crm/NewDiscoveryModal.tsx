"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CRMLead, DiscoveryProjectType, DiscoveryTemplate } from "@/types";
import { PROJECT_TYPES } from "@/lib/discovery";

interface Props {
  initialLeadId?: string;
  onClose: () => void;
}

const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";
const LABEL = "text-xs text-brand-muted mb-1 block";

// Creates a draft and opens it in the editor, where it's customized, previewed and sent.
export function NewDiscoveryModal({ initialLeadId, onClose }: Props) {
  const router = useRouter();
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [templates, setTemplates] = useState<DiscoveryTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [mode, setMode] = useState<"existing" | "new">(initialLeadId ? "existing" : "new");
  const [leadId, setLeadId] = useState(initialLeadId ?? "");
  const [org, setOrg] = useState({ name: "", website: "" });
  const [contact, setContact] = useState({ first_name: "", last_name: "", email: "" });
  const [project, setProject] = useState({ title: "", brief: "", type: "content_social" as DiscoveryProjectType });
  const [engagement, setEngagement] = useState<"pro_bono" | "paid">("pro_bono");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/crm/leads").then(r => r.json()).then(d => setLeads(Array.isArray(d) ? d : []));
    fetch("/api/crm/discovery/templates").then(r => r.json()).then(d => {
      const list: DiscoveryTemplate[] = Array.isArray(d) ? d : [];
      setTemplates(list);
      setTemplateId(id => id || (list.find(t => t.is_default) ?? list[0])?.id || "");
    });
  }, []);

  const lead = leads.find(l => l.id === leadId);
  const canSubmit = project.title.trim() &&
    (mode === "existing" ? !!leadId : org.name.trim() && contact.first_name.trim() && contact.email.trim());

  async function create() {
    setSaving(true);
    setError("");
    const body: Record<string, unknown> = {
      project_title: project.title,
      project_brief: project.brief || undefined,
      project_type: project.type,
      engagement_type: engagement,
      template_id: templateId || undefined,
    };
    if (mode === "existing") body.lead_id = leadId;
    else {
      body.org = { name: org.name, website: org.website || undefined };
      body.contact = { first_name: contact.first_name, last_name: contact.last_name || undefined, email: contact.email };
    }
    const res = await fetch("/api/crm/discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { setSaving(false); setError(data.error ?? "Could not create"); return; }
    router.push(`/crm/discovery/${data.id}`);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-brand-black">New discovery</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg" aria-label="Close">✕</button>
        </div>

          <div className="space-y-4">
            <div className="flex gap-1 p-1 bg-brand-offwhite rounded-lg">
              {(["new", "existing"] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={clsx("flex-1 text-xs py-1.5 rounded-md font-medium", mode === m ? "bg-white shadow-sm text-brand-black" : "text-brand-muted")}>
                  {m === "new" ? "New organization" : "Existing lead"}
                </button>
              ))}
            </div>

            {mode === "existing" ? (
              <div>
                <label className={LABEL}>Lead *</label>
                <select className={INPUT} value={leadId} onChange={e => setLeadId(e.target.value)}>
                  <option value="">Choose a lead…</option>
                  {leads.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.business?.name ?? "—"}{l.contact ? ` — ${l.contact.first_name} ${l.contact.last_name ?? ""}` : ""}
                    </option>
                  ))}
                </select>
                {lead && !lead.contact?.email && (
                  <p className="text-xs text-amber-700 mt-1">This lead's contact has no email — the form won't be able to prefill it.</p>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className={LABEL}>Organization *</label>
                    <input className={INPUT} value={org.name} onChange={e => setOrg({ ...org, name: e.target.value })} placeholder="Her Promise Circle Foundation" />
                  </div>
                  <div className="col-span-2">
                    <label className={LABEL}>Website</label>
                    <input className={INPUT} value={org.website} onChange={e => setOrg({ ...org, website: e.target.value })} placeholder="https://…" />
                  </div>
                  <div>
                    <label className={LABEL}>Contact first name *</label>
                    <input className={INPUT} value={contact.first_name} onChange={e => setContact({ ...contact, first_name: e.target.value })} />
                  </div>
                  <div>
                    <label className={LABEL}>Last name</label>
                    <input className={INPUT} value={contact.last_name} onChange={e => setContact({ ...contact, last_name: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <label className={LABEL}>Contact email *</label>
                    <input type="email" className={INPUT} value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-brand-muted -mt-2">Creates the business, contact and a lead in Qualification.</p>
              </>
            )}

            <div className="border-t border-brand-border pt-4 space-y-4">
              <div>
                <label className={LABEL}>Project title *</label>
                <input className={INPUT} value={project.title} onChange={e => setProject({ ...project, title: e.target.value })}
                  placeholder="Social media content workflow audit" />
              </div>
              <div>
                <label className={LABEL}>Project type *</label>
                <select className={INPUT} value={project.type} onChange={e => setProject({ ...project, type: e.target.value as DiscoveryProjectType })}>
                  {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <p className="text-xs text-brand-muted mt-1">Decides which workflow section they see.</p>
              </div>
              <div>
                <label className={LABEL}>Questionnaire template</label>
                <select className={INPUT} value={templateId} onChange={e => setTemplateId(e.target.value)}>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>)}
                </select>
                <p className="text-xs text-brand-muted mt-1">You can add, remove and reorder questions before sending.</p>
              </div>
              <div>
                <label className={LABEL}>Project description</label>
                <textarea className={clsx(INPUT, "h-32")} value={project.brief} onChange={e => setProject({ ...project, brief: e.target.value })}
                  placeholder="Paste their description (e.g. from Taproot). They'll see it first and only need to correct it." />
              </div>
              <div>
                <label className={LABEL}>Engagement</label>
                <select className={INPUT} value={engagement} onChange={e => setEngagement(e.target.value as "pro_bono" | "paid")}>
                  <option value="pro_bono">Pro bono</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
              <button onClick={create} disabled={!canSubmit || saving} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? "Creating…" : "Create draft"}
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}
