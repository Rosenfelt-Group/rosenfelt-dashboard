"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { WorkItemLog, WorkItemLogEntryType, WorkStatus } from "@/types";

const ENTRY_TYPES: WorkItemLogEntryType[] = [
  "progress", "question", "answer", "note", "error", "completion",
];

const AGENT_OPTIONS = ["riley", "jordan", "avery", "casey"];

type Props = {
  workItemId: string;
  currentUser: string;  // 'brian' or an agent name
  workItemStatus?: WorkStatus;  // drives on-hold banner; absent in legacy callers
};

const entryTypeStyles: Record<WorkItemLogEntryType, string> = {
  progress: "border-l-2 border-brand-border",
  question: "border-l-4 border-amber-400 bg-amber-50/40",
  answer: "border-l-2 border-teal-500",
  note: "border-l-2 border-brand-border",
  error: "border-l-2 border-red-500",
  completion: "border-l-2 border-green-500",
};

function capitalizeAuthor(author: string): string {
  if (author === "brian") return "Brian";
  return author.charAt(0).toUpperCase() + author.slice(1);
}

export function WorkLogPanel({ workItemId, currentUser, workItemStatus }: Props) {
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
        <LogStream logs={logs} workItemStatus={workItemStatus} />
      </div>
    </div>
  );
}

function LogStream({
  logs,
  workItemStatus,
}: {
  logs: WorkItemLog[];
  workItemStatus?: WorkStatus;
}) {
  const { questions, others } = useMemo(() => {
    const q: WorkItemLog[] = [];
    const o: WorkItemLog[] = [];
    for (const log of logs) {
      if (log.entry_type === "question") q.push(log);
      else o.push(log);
    }
    // Pinned questions: newest first so the most recent need is on top.
    q.sort((a, b) => b.created_at.localeCompare(a.created_at));
    // Other entries: chronological (oldest first) — matches reading order.
    o.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { questions: q, others: o };
  }, [logs]);

  // On-hold banner: shown when the item is on_hold AND the most recent
  // entry overall is a progress entry (agent paused mid-work, awaiting input).
  const showOnHoldBanner =
    workItemStatus === "on_hold" &&
    logs.length > 0 &&
    [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.entry_type ===
      "progress";

  if (logs.length === 0) {
    return (
      <div className="text-xs text-brand-muted text-center py-8">
        No log entries yet.
      </div>
    );
  }

  return (
    <>
      {showOnHoldBanner && (
        <div className="rounded border border-indigo-200 bg-indigo-50 text-indigo-800 text-xs px-3 py-2">
          ⏸ Agent is on hold — awaiting input from Brian
        </div>
      )}
      {questions.length > 0 && (
        <div className="space-y-3">
          {questions.map((log) => (
            <LogEntry key={log.id} log={log} pinned />
          ))}
        </div>
      )}
      {others.map((log) => (
        <LogEntry key={log.id} log={log} />
      ))}
    </>
  );
}

function LogEntry({ log, pinned = false }: { log: WorkItemLog; pinned?: boolean }) {
  const isQuestion = log.entry_type === "question";
  return (
    <div className={`pl-3 py-1 ${entryTypeStyles[log.entry_type]}`}>
      <div className="flex items-center gap-2 text-xs text-brand-muted">
        <span className="font-semibold text-brand-black">
          {capitalizeAuthor(log.author)}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-brand-cream text-brand-black">
          {log.entry_type}
        </span>
        {isQuestion && (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
            Needs clarification
          </span>
        )}
        {pinned && (
          <span className="text-amber-600 text-[10px]" title="Pinned to top">
            📌
          </span>
        )}
        <span>{new Date(log.created_at).toLocaleString()}</span>
      </div>
      <div className="text-xs mt-1 whitespace-pre-wrap text-brand-black">
        {isQuestion && <span className="mr-1">❓</span>}
        {log.message}
      </div>
    </div>
  );
}
