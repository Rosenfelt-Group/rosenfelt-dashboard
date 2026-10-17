"use client";
import { useState } from "react";
import { Tabs } from "@/components/ui";
import type { AgentName } from "@/lib/agents";
import { AgentPromptEditor } from "./AgentPromptEditor";
import { AgentMemoryPanel } from "./AgentMemory";

/**
 * System prompt + memory for one agent. Both stay mounted so switching
 * between them keeps an unsaved prompt draft.
 */
export function AgentPromptsAndMemory({ agent, readOnly = false }: {
  agent: AgentName;
  /** Without manage_intelligence: show prompt and memory but no editing controls. */
  readOnly?: boolean;
}) {
  const [view, setView] = useState<"prompt" | "memory">("prompt");
  const [memoryCount, setMemoryCount] = useState<number | null>(null);

  return (
    <div className="space-y-5">
      {readOnly && (
        <p className="text-xs text-brand-muted bg-brand-offwhite border border-brand-border rounded-lg px-3 py-2">
          Read-only — you don&apos;t have permission to edit.
        </p>
      )}
      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { id: "prompt", label: "System prompt" },
          { id: "memory", label: memoryCount === null ? "Memory" : `Memory (${memoryCount})` },
        ]}
      />
      <div hidden={view !== "prompt"}><AgentPromptEditor agent={agent} readOnly={readOnly} /></div>
      <div hidden={view !== "memory"}><AgentMemoryPanel agent={agent} onCountChange={setMemoryCount} readOnly={readOnly} /></div>
    </div>
  );
}
