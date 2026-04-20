"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";

type Agent = "jordan" | "riley" | "avery";

interface AgentPrompt {
  id: string;
  agent: Agent;
  prompt: string;
  updated_at: string;
  updated_by: string;
}

interface PromptVersion {
  id: string;
  created_at: string;
  agent: Agent;
  prompt: string;
  updated_by: string;
  note?: string;
}

interface AgentMemory {
  id: string;
  created_at: string;
  updated_at: string;
  agent: Agent;
  memory_key: string;
  memory_value: string;
  category: "preference" | "procedure" | "known_issue" | "project_context" | "general";
  rating: -1 | 0 | 1;
  source: string;
}

const AGENTS: Agent[] = ["jordan", "riley", "avery"];

const AGENT_COLORS: Record<Agent, string> = {
  jordan: "bg-blue-50 text-blue-700 border-blue-200",
  riley:  "bg-purple-50 text-purple-700 border-purple-200",
  avery:  "bg-green-50 text-green-700 border-green-200",
};

const CATEGORY_STYLES: Record<string, string> = {
  preference:      "bg-orange-50 text-orange-700",
  procedure:       "bg-blue-50 text-blue-700",
  known_issue:     "bg-red-50 text-red-700",
  project_context: "bg-violet-50 text-violet-700",
  general:         "bg-gray-100 text-gray-600",
};

const CATEGORY_LABELS: Record<string, string> = {
  preference:      "Preference",
  procedure:       "Procedure",
  known_issue:     "Known Issue",
  project_context: "Project Context",
  general:         "General",
};

// ─── Memory Card ──────────────────────────────────────────────────────────────

function MemoryCard({ memory, onRate, onDelete, onEdit }: {
  memory: AgentMemory;
  onRate: (id: string, rating: -1 | 0 | 1) => void;
  onDelete: (id: string) => void;
  onEdit: (memory: AgentMemory) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={clsx(
      "bg-white rounded-lg border p-3 space-y-2",
      memory.rating === 1  ? "border-green-200" :
      memory.rating === -1 ? "border-red-200" : "border-brand-border"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold text-brand-black">{memory.memory_key}</span>
            <span className={clsx("text-[10px] px-1.5 py-0.5 rounded font-medium", CATEGORY_STYLES[memory.category])}>
              {CATEGORY_LABELS[memory.category]}
            </span>
          </div>
          <p className="text-xs text-brand-muted leading-relaxed">{memory.memory_value}</p>
        </div>
        {/* Rating */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button
            onClick={() => onRate(memory.id, memory.rating === 1 ? 0 : 1)}
            className={clsx("w-6 h-6 rounded flex items-center justify-center text-xs transition-colors",
              memory.rating === 1 ? "bg-green-100 text-green-700" : "bg-brand-offwhite text-brand-muted hover:bg-green-50 hover:text-green-600"
            )}
            title="Good memory — reinforce"
          >👍</button>
          <button
            onClick={() => onRate(memory.id, memory.rating === -1 ? 0 : -1)}
            className={clsx("w-6 h-6 rounded flex items-center justify-center text-xs transition-colors",
              memory.rating === -1 ? "bg-red-100 text-red-700" : "bg-brand-offwhite text-brand-muted hover:bg-red-50 hover:text-red-600"
            )}
            title="Bad memory — suppress"
          >👎</button>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-brand-border">
        <span className="text-[10px] text-brand-muted">
          {formatDistanceToNow(parseISO(memory.updated_at), { addSuffix: true })} · {memory.source}
        </span>
        <div className="flex gap-2">
          <button onClick={() => onEdit(memory)} className="text-xs text-brand-orange hover:text-orange-700 transition-colors">
            Edit
          </button>
          {confirming ? (
            <div className="flex gap-1 items-center">
              <button onClick={() => { onDelete(memory.id); setConfirming(false); }}
                className="text-xs text-red-600 hover:text-red-800">Yes</button>
              <button onClick={() => setConfirming(false)}
                className="text-xs text-brand-muted">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:text-red-700 transition-colors">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Memory Edit Modal ────────────────────────────────────────────────────────

function MemoryModal({ memory, onSave, onClose }: {
  memory: Partial<AgentMemory> & { agent: Agent };
  onSave: (updates: Partial<AgentMemory>) => void;
  onClose: () => void;
}) {
  const [key,      setKey]      = useState(memory.memory_key ?? "");
  const [value,    setValue]    = useState(memory.memory_value ?? "");
  const [category, setCategory] = useState(memory.category ?? "general");

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full md:max-w-lg md:rounded-xl rounded-t-2xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-brand-border rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
          <h2 className="text-base font-semibold text-brand-black">
            {memory.id ? "Edit Memory" : "Add Memory"}
          </h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-brand-muted hover:bg-brand-offwhite">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Key</label>
            <input value={key} onChange={e => setKey(e.target.value)}
              className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
              placeholder="e.g. brian_prefers_bullet_points" />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Value</label>
            <textarea value={value} onChange={e => setValue(e.target.value)} rows={4}
              className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange resize-none"
              placeholder="What should the agent remember?" />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as AgentMemory["category"])}
              className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange">
              <option value="preference">Preference — how Brian likes things done</option>
              <option value="procedure">Procedure — how to handle a specific situation</option>
              <option value="known_issue">Known Issue — a bug or problem to be aware of</option>
              <option value="project_context">Project Context — current work context</option>
              <option value="general">General — everything else</option>
            </select>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-brand-border flex gap-2">
          <button onClick={() => onSave({ memory_key: key, memory_value: value, category: category as AgentMemory["category"] })}
            disabled={!key.trim() || !value.trim()}
            className="btn-primary flex-1 disabled:opacity-40">
            Save
          </button>
          <button onClick={onClose} className="btn-ghost px-5">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentPromptsPage() {
  const [activeAgent,   setActiveAgent]   = useState<Agent>("jordan");
  const [activeTab,     setActiveTab]     = useState<"prompt" | "memory">("prompt");
  const [prompt,        setPrompt]        = useState("");
  const [promptDraft,   setPromptDraft]   = useState("");
  const [promptMeta,    setPromptMeta]    = useState<AgentPrompt | null>(null);
  const [versions,      setVersions]      = useState<PromptVersion[]>([]);
  const [memories,      setMemories]      = useState<AgentMemory[]>([]);
  const [memoryFilter,  setMemoryFilter]  = useState<string>("all");
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [saveNote,      setSaveNote]      = useState("");
  const [showVersions,  setShowVersions]  = useState(false);
  const [previewVersion, setPreviewVersion] = useState<PromptVersion | null>(null);
  const [editingMemory,  setEditingMemory]  = useState<(Partial<AgentMemory> & { agent: Agent }) | null>(null);
  const [dirty,         setDirty]         = useState(false);

  useEffect(() => {
    loadAgent(activeAgent);
  }, [activeAgent]);

  async function loadAgent(agent: Agent) {
    setLoading(true);
    setDirty(false);
    setShowVersions(false);
    setPreviewVersion(null);

    const [promptRes, versionsRes, memoryRes] = await Promise.all([
      fetch(`/api/agent-prompts?agent=${agent}`).then(r => r.json()),
      fetch(`/api/agent-prompts/versions?agent=${agent}`).then(r => r.json()),
      fetch(`/api/agent-memory?agent=${agent}`).then(r => r.json()),
    ]);

    setPromptMeta(promptRes);
    setPrompt(promptRes?.prompt ?? "");
    setPromptDraft(promptRes?.prompt ?? "");
    setVersions(versionsRes ?? []);
    setMemories(memoryRes ?? []);
    setLoading(false);
  }

  async function handleSavePrompt() {
    if (!dirty) return;
    setSaving(true);
    await fetch("/api/agent-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: activeAgent, prompt: promptDraft, note: saveNote }),
    });
    setPrompt(promptDraft);
    setDirty(false);
    setSaveNote("");
    setSaving(false);
    // Reload versions
    const v = await fetch(`/api/agent-prompts/versions?agent=${activeAgent}`).then(r => r.json());
    setVersions(v ?? []);
  }

  async function handleRestoreVersion(version: PromptVersion) {
    setPromptDraft(version.prompt);
    setDirty(true);
    setPreviewVersion(null);
    setShowVersions(false);
    setSaveNote(`Restored from ${formatDistanceToNow(parseISO(version.created_at), { addSuffix: true })}`);
  }

  async function handleRateMemory(id: string, rating: -1 | 0 | 1) {
    await fetch("/api/agent-memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, rating }),
    });
    setMemories(prev => prev.map(m => m.id === id ? { ...m, rating } : m));
  }

  async function handleDeleteMemory(id: string) {
    await fetch("/api/agent-memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setMemories(prev => prev.filter(m => m.id !== id));
  }

  async function handleSaveMemory(updates: Partial<AgentMemory>) {
    if (!editingMemory) return;
    if (editingMemory.id) {
      // Update
      await fetch("/api/agent-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingMemory.id, ...updates }),
      });
      setMemories(prev => prev.map(m => m.id === editingMemory.id ? { ...m, ...updates } : m));
    } else {
      // Create
      const res = await fetch("/api/agent-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: activeAgent, source: "manual", rating: 0, ...updates }),
      });
      const created = await res.json();
      setMemories(prev => [created, ...prev]);
    }
    setEditingMemory(null);
  }

  const filteredMemories = memoryFilter === "all"
    ? memories
    : memoryFilter === "flagged"
      ? memories.filter(m => m.rating === -1)
      : memories.filter(m => m.category === memoryFilter);

  const memoryCounts = {
    all:             memories.length,
    preference:      memories.filter(m => m.category === "preference").length,
    procedure:       memories.filter(m => m.category === "procedure").length,
    known_issue:     memories.filter(m => m.category === "known_issue").length,
    project_context: memories.filter(m => m.category === "project_context").length,
    general:         memories.filter(m => m.category === "general").length,
    flagged:         memories.filter(m => m.rating === -1).length,
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="card animate-pulse h-16" />
        <div className="card animate-pulse h-96" />
      </div>
    );
  }

  return (
    <>
      {editingMemory && (
        <MemoryModal
          memory={editingMemory}
          onSave={handleSaveMemory}
          onClose={() => setEditingMemory(null)}
        />
      )}

      <div className="p-4 md:p-8 pb-24 md:pb-8 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-brand-black">Agent Intelligence</h1>
            <p className="text-sm text-brand-muted mt-0.5">Prompts, memory, and behavioral tuning</p>
          </div>
        </div>

        {/* Agent tabs */}
        <div className="flex gap-2">
          {AGENTS.map(a => (
            <button key={a} onClick={() => setActiveAgent(a)}
              className={clsx(
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize border",
                activeAgent === a ? AGENT_COLORS[a] : "bg-white text-brand-muted border-brand-border hover:bg-brand-offwhite"
              )}>
              {a}
            </button>
          ))}
        </div>

        {/* Prompt / Memory tab switcher */}
        <div className="flex gap-1 border-b border-brand-border">
          {(["prompt", "memory"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={clsx(
                "px-4 py-2 text-sm font-medium transition-colors capitalize relative",
                activeTab === t ? "text-brand-black" : "text-brand-muted hover:text-brand-black"
              )}>
              {t === "memory" ? `Memory (${memories.length})` : "System Prompt"}
              {activeTab === t && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-brand-orange rounded-full" />}
            </button>
          ))}
        </div>

        {/* ── PROMPT TAB ── */}
        {activeTab === "prompt" && (
          <div className="space-y-4">
            {/* Prompt meta */}
            {promptMeta && (
              <div className="flex items-center justify-between text-xs text-brand-muted">
                <span>
                  Last updated {formatDistanceToNow(parseISO(promptMeta.updated_at), { addSuffix: true })} by {promptMeta.updated_by}
                </span>
                <button onClick={() => setShowVersions(!showVersions)}
                  className="text-brand-orange hover:underline">
                  {showVersions ? "Hide" : "View"} history ({versions.length})
                </button>
              </div>
            )}

            {/* Version history panel */}
            {showVersions && (
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-2 border-b border-brand-border bg-brand-offwhite">
                  <p className="text-xs font-medium text-brand-muted">Version History</p>
                </div>
                {versions.length === 0 ? (
                  <p className="text-xs text-brand-muted p-4">No versions yet — save the prompt to create the first version.</p>
                ) : (
                  versions.map(v => (
                    <div key={v.id} className="flex items-center justify-between px-4 py-2.5 border-b border-brand-border last:border-0 hover:bg-brand-offwhite">
                      <div>
                        <p className="text-xs font-medium text-brand-black">
                          {formatDistanceToNow(parseISO(v.created_at), { addSuffix: true })}
                        </p>
                        {v.note && <p className="text-xs text-brand-muted">{v.note}</p>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setPreviewVersion(previewVersion?.id === v.id ? null : v)}
                          className="text-xs text-brand-orange hover:underline">
                          {previewVersion?.id === v.id ? "Hide" : "Preview"}
                        </button>
                        <button onClick={() => handleRestoreVersion(v)}
                          className="text-xs text-brand-muted hover:text-brand-black">
                          Restore
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Version preview */}
            {previewVersion && (
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-2 border-b border-brand-border bg-amber-50 flex items-center justify-between">
                  <p className="text-xs font-medium text-amber-700">
                    Previewing version from {formatDistanceToNow(parseISO(previewVersion.created_at), { addSuffix: true })}
                  </p>
                  <button onClick={() => handleRestoreVersion(previewVersion)}
                    className="text-xs text-brand-orange font-medium hover:underline">
                    Restore this version
                  </button>
                </div>
                <pre className="text-xs text-brand-muted p-4 overflow-x-auto whitespace-pre-wrap font-mono max-h-64">
                  {previewVersion.prompt}
                </pre>
              </div>
            )}

            {/* Prompt editor */}
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-2 border-b border-brand-border bg-brand-offwhite flex items-center justify-between">
                <p className="text-xs font-medium text-brand-muted capitalize">{activeAgent} system prompt</p>
                {dirty && <span className="text-xs text-amber-600 font-medium">● Unsaved changes</span>}
              </div>
              <textarea
                value={promptDraft}
                onChange={e => { setPromptDraft(e.target.value); setDirty(e.target.value !== prompt); }}
                className="w-full text-sm font-mono p-4 focus:outline-none resize-none min-h-[400px] bg-white"
                placeholder="Enter system prompt..."
                spellCheck={false}
              />
            </div>

            {/* Save bar */}
            {dirty && (
              <div className="flex gap-2 items-center">
                <input
                  value={saveNote}
                  onChange={e => setSaveNote(e.target.value)}
                  className="flex-1 text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
                  placeholder="Optional note about this change..."
                />
                <button onClick={handleSavePrompt} disabled={saving}
                  className="btn-primary disabled:opacity-40 whitespace-nowrap">
                  {saving ? "Saving…" : "Save prompt"}
                </button>
                <button onClick={() => { setPromptDraft(prompt); setDirty(false); }}
                  className="btn-ghost whitespace-nowrap">
                  Discard
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── MEMORY TAB ── */}
        {activeTab === "memory" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-1 overflow-x-auto scrollbar-none pb-1">
                {[
                  { key: "all", label: `All (${memoryCounts.all})` },
                  { key: "preference", label: `Preferences (${memoryCounts.preference})` },
                  { key: "procedure", label: `Procedures (${memoryCounts.procedure})` },
                  { key: "known_issue", label: `Issues (${memoryCounts.known_issue})` },
                  { key: "project_context", label: `Context (${memoryCounts.project_context})` },
                  { key: "general", label: `General (${memoryCounts.general})` },
                  ...(memoryCounts.flagged > 0 ? [{ key: "flagged", label: `⚑ Flagged (${memoryCounts.flagged})` }] : []),
                ].map(f => (
                  <button key={f.key} onClick={() => setMemoryFilter(f.key)}
                    className={clsx(
                      "px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors flex-shrink-0",
                      memoryFilter === f.key ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
                    )}>
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setEditingMemory({ agent: activeAgent })}
                className="btn-primary text-xs py-1.5 ml-2 flex-shrink-0">
                + Add
              </button>
            </div>

            {filteredMemories.length === 0 ? (
              <div className="card flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm font-medium text-brand-black mb-1">No memories yet</p>
                <p className="text-xs text-brand-muted max-w-xs mb-4">
                  {activeAgent === "jordan"
                    ? "Jordan will start building memory automatically as you have more conversations."
                    : "Memories will appear here as this agent becomes active."}
                </p>
                <button onClick={() => setEditingMemory({ agent: activeAgent })}
                  className="text-xs text-brand-orange hover:underline">
                  + Add one manually
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredMemories.map(m => (
                  <MemoryCard
                    key={m.id}
                    memory={m}
                    onRate={handleRateMemory}
                    onDelete={handleDeleteMemory}
                    onEdit={mem => setEditingMemory(mem)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
