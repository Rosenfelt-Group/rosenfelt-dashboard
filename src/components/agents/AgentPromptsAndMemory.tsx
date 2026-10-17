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
export function AgentPromptsAndMemory({ agent }: { agent: AgentName }) {
  const [view, setView] = useState<"prompt" | "memory">("prompt");
  const [memoryCount, setMemoryCount] = useState<number | null>(null);

  return (
    <div className="space-y-5">
      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { id: "prompt", label: "System prompt" },
          { id: "memory", label: memoryCount === null ? "Memory" : `Memory (${memoryCount})` },
        ]}
      />
      <div hidden={view !== "prompt"}><AgentPromptEditor agent={agent} /></div>
      <div hidden={view !== "memory"}><AgentMemoryPanel agent={agent} onCountChange={setMemoryCount} /></div>
    </div>
  );
}
