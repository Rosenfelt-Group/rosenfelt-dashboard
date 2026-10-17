"use client";
// Live system prompt for one agent (/api/agent-prompts) with version history,
// preview and restore. Changes take effect on the agent's next message.
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { fetchJson } from "@/lib/fetch-json";
import type { AgentName } from "@/lib/agents";

type Agent = AgentName;

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

export function AgentPromptEditor({ agent }: { agent: Agent }) {
  const [prompt,         setPrompt]         = useState("");
  const [promptDraft,    setPromptDraft]    = useState("");
  const [promptMeta,     setPromptMeta]     = useState<AgentPrompt | null>(null);
  const [versions,       setVersions]       = useState<PromptVersion[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [saveNote,       setSaveNote]       = useState("");
  const [showVersions,   setShowVersions]   = useState(false);
  const [previewVersion, setPreviewVersion] = useState<PromptVersion | null>(null);
  const [dirty,          setDirty]          = useState(false);
  const [loadError,      setLoadError]      = useState<string | null>(null);
  const [promptError,    setPromptError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setDirty(false);
    setShowVersions(false);
    setPreviewVersion(null);
    setPromptError(null);

    const [promptR, versionsR] = await Promise.all([
      fetchJson<AgentPrompt | null>(`/api/agent-prompts?agent=${agent}`),
      fetchJson<PromptVersion[]>(`/api/agent-prompts/versions?agent=${agent}`),
    ]);
    const failed = [promptR, versionsR].find(r => !r.ok);
    setLoadError(failed && !failed.ok ? failed.error : null);
    const promptRes = promptR.ok ? promptR.data : null;

    setPromptMeta(promptRes);
    setPrompt(promptRes?.prompt ?? "");
    setPromptDraft(promptRes?.prompt ?? "");
    setVersions(versionsR.ok ? versionsR.data ?? [] : []);
    setLoading(false);
  }, [agent]);

  useEffect(() => { load(); }, [load]);

  async function handleSavePrompt() {
    if (!dirty) return;
    setSaving(true);
    setPromptError(null);
    const saveRes = await fetchJson("/api/agent-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, prompt: promptDraft, note: saveNote }),
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
    const v = await fetchJson<PromptVersion[]>(`/api/agent-prompts/versions?agent=${agent}`);
    if (v.ok) setVersions(v.data ?? []);
  }

  async function handleRestoreVersion(version: PromptVersion) {
    setPromptDraft(version.prompt);
    setDirty(true);
    setPreviewVersion(null);
    setShowVersions(false);
    setSaveNote(`Restored from ${formatDistanceToNow(parseISO(version.created_at), { addSuffix: true })}`);
  }

  if (loading) return <LoadingState />;

  return (
    <>
      {loadError && (
        <ErrorState message={`Couldn't load ${agent}'s prompt: ${loadError}`} onRetry={load} className="mb-4" />
      )}
      <div className="space-y-4">
        {promptMeta && (
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-brand-muted">
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
            <p className="text-xs font-medium text-brand-muted capitalize">{agent} system prompt</p>
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
          <div className="flex gap-2 items-center flex-wrap">
            <input
              value={saveNote}
              onChange={e => setSaveNote(e.target.value)}
              className="flex-1 min-w-[12rem] text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
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
    </>
  );
}
