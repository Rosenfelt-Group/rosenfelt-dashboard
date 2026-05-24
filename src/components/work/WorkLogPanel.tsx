"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { WorkItemLog, WorkItemLogEntryType } from "@/types";

const ENTRY_TYPES: WorkItemLogEntryType[] = [
  "progress", "question", "answer", "note", "error", "completion",
];

const AGENT_OPTIONS = ["riley", "jordan", "avery", "casey"];

type Props = {
  workItemId: string;
  currentUser: string;  // 'brian' or an agent name
};

const entryTypeStyles: Record<WorkItemLogEntryType, string> = {
  progress: "border-l-2 border-brand-border",
  question: "border-l-2 border-amber-500",
  answer: "border-l-2 border-teal-500",
  note: "border-l-2 border-brand-border",
  error: "border-l-2 border-red-500",
  completion: "border-l-2 border-green-500",
};

function capitalizeAuthor(author: string): string {
  if (author === "brian") return "Brian";
  return author.charAt(0).toUpperCase() + author.slice(1);
}

export function WorkLogPanel({ workItemId, currentUser }: Props) {
  const [logs, setLogs] = useState<WorkItemLog[]>([]);
  const [entryType, setEntryType] = useState<WorkItemLogEntryType>("progress");
  const [message, setMessage] = useState("");
  const [posting, setPosting] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial load + Realtime subscription
  useEffect(() => {
    let mounted = true;

    async function load() {
      const res = await fetch(`/api/work/${workItemId}/logs`);
      if (!res.ok) return;
      const data = await res.json();
      if (mounted) setLogs(data.logs ?? []);
    }
    load();

    const channel = supabase
      .channel(`work-item-logs-${workItemId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "work_item_logs",
          filter: `work_item_id=eq.${workItemId}`,
        },
        (payload) => {
          const row = payload.new as WorkItemLog;
          setLogs((prev) => {
            if (prev.some((l) => l.id === row.id)) return prev;
            return [...prev, row];
          });
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [workItemId]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  function handleMessageChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setMessage(value);
    const lastChar = value.slice(-1);
    setShowMentions(lastChar === "@");
  }

  function insertMention(agent: string) {
    setMessage((prev) => prev + agent + " ");
    setShowMentions(false);
    textareaRef.current?.focus();
  }

  async function post() {
    if (!message.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/work/${workItemId}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: currentUser,
          author_type: currentUser === "brian" ? "human" : "agent",
          entry_type: entryType,
          message,
        }),
      });
      if (res.ok) {
        setMessage("");
        setEntryType("progress");
      } else {
        console.error("Failed to post log:", await res.text());
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Composer */}
      <div className="border-b border-brand-border p-3 space-y-2 bg-brand-cream">
        <div className="flex gap-2 items-start">
          <select
            value={entryType}
            onChange={(e) => setEntryType(e.target.value as WorkItemLogEntryType)}
            className="rounded border border-brand-border px-2 py-1 text-xs bg-white"
          >
            {ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleMessageChange}
              placeholder="Type a note, @mention an agent..."
              rows={2}
              className="w-full rounded border border-brand-border px-2 py-1 text-xs resize-none focus:outline-none focus:border-brand-orange"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  post();
                }
              }}
            />
            {showMentions && (
              <div className="absolute z-10 bottom-full left-0 mb-1 bg-white border border-brand-border rounded shadow-md">
                {AGENT_OPTIONS.map((a) => (
                  <button
                    key={a}
                    onClick={() => insertMention(a)}
                    className="block w-full text-left px-3 py-1 hover:bg-brand-cream text-xs"
                  >
                    @{a}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={post}
            disabled={!message.trim() || posting}
            className="rounded bg-brand-orange text-white px-3 py-1 text-xs disabled:opacity-50"
          >
            {posting ? "..." : "Post"}
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-white">
        {logs.length === 0 ? (
          <div className="text-xs text-brand-muted text-center py-8">
            No log entries yet.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={`pl-3 ${entryTypeStyles[log.entry_type]}`}>
              <div className="flex items-center gap-2 text-xs text-brand-muted">
                <span className="font-semibold text-brand-black">
                  {capitalizeAuthor(log.author)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-brand-cream text-brand-black">
                  {log.entry_type}
                </span>
                <span>{new Date(log.created_at).toLocaleString()}</span>
              </div>
              <div className="text-xs mt-1 whitespace-pre-wrap text-brand-black">
                {log.message}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
