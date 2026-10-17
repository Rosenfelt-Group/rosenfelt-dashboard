"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Button, ErrorState, LoadingState, Modal, PageHeader, Tabs } from "@/components/ui";
import { fetchJson } from "@/lib/fetch-json";

type Agent = "jordan" | "riley" | "avery" | "casey" | "sam";

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
  pinned?: boolean;
  use_count?: number;
  last_used_at?: string | null;
  source: string;
}

const AGENTS: Agent[] = ["jordan", "riley", "avery", "casey", "sam"];

const AGENT_COLORS: Record<Agent, string> = {
  jordan: "bg-blue-50 text-blue-700 border-blue-200",
  riley:  "bg-purple-50 text-purple-700 border-purple-200",
  avery:  "bg-green-50 text-green-700 border-green-200",
  casey:  "bg-rose-50 text-rose-700 border-rose-200",
  sam:    "bg-gray-50 text-gray-600 border-gray-200",
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

function MemoryCard({ memory, onRate, onPin, onDelete, onEdit }: {
  memory: AgentMemory;
  onRate: (id: string, rating: -1 | 0 | 1) => void;
  onPin: (id: string, pinned: boolean) => void;
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
          {formatDistanceToNow(parseISO(memory.updated_at), { addSuffix: true })} · {memory.source} · used {memory.use_count ?? 0}×
        </span>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => onPin(memory.id, !memory.pinned)}
            className={clsx("text-xs px-1.5 py-0.5 rounded transition-colors",
              memory.pinned ? "bg-amber-100 text-amber-700" : "bg-brand-offwhite text-brand-muted hover:bg-amber-50 hover:text-amber-600")}
            title={memory.pinned ? "Pinned — always retrieved, never pruned" : "Pin this memory"}
          >
            {memory.pinned ? "📌 Pinned" : "Pin"}
          </button>
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

// ─── Memory API helpers ───────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "network error";
}

// Calls /api/agent-memory and throws on a non-ok response so callers can revert
// optimistic UI and surface the failure instead of silently appearing to succeed.
async function memoryRequest(method: string, body: unknown) {
  const res = await fetch("/api/agent-memory", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json().catch(() => ({}));
}

function MemoryModal({ memory, onSave, onClose }: {
  memory: Partial<AgentMemory> & { agent: Agent };
  onSave: (updates: Partial<AgentMemory>) => Promise<void>;
  onClose: () => void;
}) {
  const [key,      setKey]      = useState(memory.memory_key ?? "");
  const [value,    setValue]    = useState(memory.memory_value ?? "");
  const [category, setCategory] = useState(memory.category ?? "general");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave({ memory_key: key, memory_value: value, category: category as AgentMemory["category"] });
      // On success the parent unmounts this modal; no need to clear `saving`.
    } catch (e) {
      setError(errMsg(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={memory.id ? "Edit Memory" : "Add Memory"}
      size="lg"
      closeOnBackdrop={!saving}
      footer={
        <>
          <Button className="flex-1" onClick={save} disabled={!key.trim() || !value.trim() || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" className="px-5" onClick={onClose} disabled={saving}>Cancel</Button>
        </>
      }
    >
      <div className="space-y-4">
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
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Couldn&apos;t save: {error}
          </p>
        )}
      </div>
    </Modal>
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
  const [memoryError,   setMemoryError]   = useState<string | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [promptError,   setPromptError]   = useState<string | null>(null);

  useEffect(() => {
    loadAgent(activeAgent);
  }, [activeAgent]);

  async function loadAgent(agent: Agent) {
    setLoading(true);
    setDirty(false);
    setShowVersions(false);
    setPreviewVersion(null);

    setPromptError(null);

    const [promptR, versionsR, memoryR] = await Promise.all([
      fetchJson<AgentPrompt | null>(`/api/agent-prompts?agent=${agent}`),
      fetchJson<PromptVersion[]>(`/api/agent-prompts/versions?agent=${agent}`),
      fetchJson<AgentMemory[]>(`/api/agent-memory?agent=${agent}`),
    ]);
    const failed = [promptR, versionsR, memoryR].find(r => !r.ok);
    setLoadError(failed && !failed.ok ? failed.error : null);
    const promptRes = promptR.ok ? promptR.data : null;

    setPromptMeta(promptRes);
    setPrompt(promptRes?.prompt ?? "");
    setPromptDraft(promptRes?.prompt ?? "");
    setVersions(versionsR.ok ? versionsR.data ?? [] : []);
    setMemories(memoryR.ok ? memoryR.data ?? [] : []);
    setLoading(false);
  }

  async function handleSavePrompt() {
    if (!dirty) return;
    setSaving(true);
    setPromptError(null);
    const saveRes = await fetchJson("/api/agent-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: activeAgent, prompt: promptDraft, note: saveNote }),
    });
    if (!saveRes.ok) {
      setPromptError(`Couldn't save the prompt: ${saveRes.error}`);
      setSaving(false);
      return;
    }
    setPrompt(promptDraft);
    setDirty(false);
    setSaveNote("");
    setSaving(false);
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
    const previous = memories.find(m => m.id === id)?.rating ?? 0;
    // Optimistic update, reverted below if the request fails.
    setMemoryError(null);
    setMemories(prev => prev.map(m => m.id === id ? { ...m, rating } : m));
    try {
      await memoryRequest("PATCH", { id, rating });
    } catch (err) {
      setMemories(prev => prev.map(m => m.id === id ? { ...m, rating: previous } : m));
      setMemoryError(`Couldn't update rating: ${errMsg(err)}`);
    }
  }

  async function handlePinMemory(id: string, pinned: boolean) {
    const previous = memories.find(m => m.id === id)?.pinned;
    // Optimistic update, reverted below if the request fails.
    setMemoryError(null);
    setMemories(prev => prev.map(m => m.id === id ? { ...m, pinned } : m));
    try {
      await memoryRequest("PATCH", { id, pinned });
    } catch (err) {
      setMemories(prev => prev.map(m => m.id === id ? { ...m, pinned: previous } : m));
      setMemoryError(`Couldn't ${pinned ? "pin" : "unpin"} that memory: ${errMsg(err)}`);
    }
  }

  async function handleDeleteMemory(id: string) {
    // Not optimistic: removing then re-inserting on failure would lose list
    // order, so we only drop the row after the delete is confirmed.
    setMemoryError(null);
    try {
      await memoryRequest("DELETE", { id });
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      setMemoryError(`Couldn't delete that memory: ${errMsg(err)}`);
    }
  }

  // Throws on failure so MemoryModal keeps itself open and shows the error;
  // only closes (clears editingMemory) on success.
  async function handleSaveMemory(updates: Partial<AgentMemory>) {
    if (!editingMemory) return;
    if (editingMemory.id) {
      await memoryRequest("PATCH", { id: editingMemory.id, ...updates });
      setMemories(prev => prev.map(m => m.id === editingMemory.id ? { ...m, ...updates } : m));
    } else {
      const created = await memoryRequest("POST", { agent: activeAgent, source: "manual", rating: 0, ...updates });
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
      <div className="p-4 md:p-8">
        <LoadingState />
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
        <PageHeader title="Agent Intelligence" description="Prompts, memory, and behavioral tuning" />

        {loadError && (
          <ErrorState message={`Couldn't load ${activeAgent}'s settings: ${loadError}`} onRetry={() => loadAgent(activeAgent)} />
        )}

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
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: "prompt", label: "System Prompt" },
            { id: "memory", label: `Memory (${memories.length})` },
          ]}
        />

        {/* ── PROMPT TAB ── */}
        {activeTab === "prompt" && (
          <div className="space-y-4">
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
                <pre className="text-xs text-brand-muted p-4 overflow-x-auto whitespace-pre-wrap font-mono max-h-64 [-webkit-overflow-scrolling:touch]">
                  {previewVersion.prompt}
                </pre>
              </div>
            )}

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

            {promptError && <ErrorState message={promptError} />}

            {dirty && (
              <div className="flex gap-2 items-center">
                <input
                  value={saveNote}
                  onChange={e => setSaveNote(e.target.value)}
                  className="flex-1 text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
                  placeholder="Optional note about this change..."
                />
                <Button onClick={handleSavePrompt} disabled={saving} className="whitespace-nowrap">
                  {saving ? "Saving…" : "Save prompt"}
                </Button>
                <Button variant="ghost" onClick={() => { setPromptDraft(prompt); setDirty(false); }} className="whitespace-nowrap">
                  Discard
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── MEMORY TAB ── */}
        {activeTab === "memory" && (
          <div className="space-y-4">
            {memoryError && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <span className="flex-1">{memoryError}</span>
                <button
                  onClick={() => setMemoryError(null)}
                  aria-label="Dismiss"
                  className="text-red-600 hover:text-red-800 font-medium flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex gap-1 overflow-x-auto scrollbar-none pb-1 [-webkit-overflow-scrolling:touch]">
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
                      "px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors flex-shrink-0 touch-manipulation",
                      memoryFilter === f.key ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
                    )}>
                    {f.label}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={() => setEditingMemory({ agent: activeAgent })} className="ml-2 flex-shrink-0">
                + Add
              </Button>
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
                    onPin={handlePinMemory}
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
