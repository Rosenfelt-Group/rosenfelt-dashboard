"use client";
// Dashboard chat with one agent. History is stored by the agent in Supabase
// (session `${agent}_dashboard_brian`) and read back via GET /api/chat.
import { useState, useEffect, useRef } from "react";
import { AgentBadge } from "@/components/AgentBadge";
import { SamMarkdown } from "@/components/SamMarkdown";
import type { AgentName } from "@/lib/agents";
import { getAgentInfo } from "@/lib/agents";

type Agent = AgentName;
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { ErrorState } from "@/components/ui";
import { fetchJson } from "@/lib/fetch-json";

type Message = {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

const AGENT_PROMPTS: Partial<Record<Agent, string>> = {
  jordan: "Ask about workflows, containers, VPS status, or tasks.",
  avery: "Ask Avery to draft blog posts, research topics, or manage content.",
  riley: "Ask Riley about CRM data, leads, or client activity.",
  casey: "Ask Casey about audit findings, schema drift, or system health checks.",
  sam: "Ask Sam about invoices, financials, contracts, or HR — actions require your approval.",
};

const CHAT_ID = "dashboard_brian";

function MessageBubble({ msg, agent }: { msg: Message; agent: Agent }) {
  const isUser = msg.role === "user";
  // Sam's prompt emits Markdown; the other four still speak Telegram HTML — see SamMarkdown.tsx
  const isSamMarkdown = agent === "sam" && !isUser;

  const formatted = msg.content
    .replace(/<b>(.*?)<\/b>/g, "$1")
    .replace(/<i>(.*?)<\/i>/g, "$1")
    .replace(/<code>(.*?)<\/code>/g, "`$1`");

  return (
    <div className={clsx("flex gap-2 sm:gap-3 max-w-3xl", isUser ? "ml-auto flex-row-reverse" : "")}>
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <AgentBadge agent={agent} />
        </div>
      )}
      <div className={clsx(
        "rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-xl min-w-0 break-words",
        !isSamMarkdown && "whitespace-pre-wrap",
        isUser
          ? "bg-brand-orange text-white rounded-tr-sm"
          : "bg-white border border-brand-border text-brand-black rounded-tl-sm"
      )}>
        {isSamMarkdown ? <SamMarkdown content={msg.content} /> : formatted}
      </div>
    </div>
  );
}

function TypingIndicator({ agent }: { agent: Agent }) {
  return (
    <div className="flex gap-3 max-w-3xl">
      <div className="flex-shrink-0 mt-1">
        <AgentBadge agent={agent} />
      </div>
      <div className="bg-white border border-brand-border rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="w-1.5 h-1.5 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="w-1.5 h-1.5 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

export function AgentChat({ agent }: { agent: Agent }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history when agent changes
  useEffect(() => {
    setLoadingHistory(true);
    setHistoryError(null);
    setMessages([]);
    fetchJson<unknown>(`/api/chat?agent=${agent}&chatId=${CHAT_ID}`).then(r => {
      if (r.ok) setMessages(Array.isArray(r.data) ? r.data : []);
      else setHistoryError(r.error);
      setLoadingHistory(false);
    });
  }, [agent, historyAttempt]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, loading]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      role: "user",
      content: input.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    inputRef.current?.focus();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          agent,
          chatId: CHAT_ID,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `⚠️ Error: ${data.error}`,
          created_at: new Date().toISOString(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: data.response,
          created_at: new Date().toISOString(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "⚠️ Could not reach the agent. Check that the service is running.",
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const label = getAgentInfo(agent).label;

  return (
    <div className="card p-0 overflow-hidden flex flex-col h-[calc(100dvh-15rem)] min-h-[420px]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 bg-brand-offwhite">
        {loadingHistory ? (
          <div className="text-center text-sm text-brand-muted py-8">Loading history...</div>
        ) : historyError && messages.length === 0 ? (
          <ErrorState
            message={`Couldn't load chat history: ${historyError}`}
            onRetry={() => setHistoryAttempt(n => n + 1)}
          />
        ) : messages.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-white rounded-xl border border-brand-border flex items-center justify-center mx-auto mb-4">
              <AgentBadge agent={agent} />
            </div>
            <p className="text-sm font-medium text-brand-black capitalize">{agent} is ready</p>
            <p className="text-xs text-brand-muted mt-1">
              {AGENT_PROMPTS[agent] ?? `Send ${agent} a message to get started.`}
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} agent={agent} />
          ))
        )}

        {loading && <TypingIndicator agent={agent} />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 sm:px-6 py-3 sm:py-4 bg-white border-t border-brand-border flex-shrink-0">
        <div className="flex gap-3 items-end max-w-3xl">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${label}... (Enter to send, Shift+Enter for newline)`}
            disabled={loading}
            rows={1}
            className="flex-1 min-w-0 resize-none border border-brand-border rounded-xl px-4 py-3 text-sm
                       focus:outline-none focus:border-brand-orange transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       bg-brand-offwhite"
            style={{ maxHeight: "120px" }}
            onInput={e => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            aria-label="Send"
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-orange text-white
                       flex items-center justify-center hover:bg-brand-orange-dark
                       transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13"/>
              <path d="M22 2L15 22 11 13 2 9l20-7z"/>
            </svg>
          </button>
        </div>
        <p className="text-xs text-brand-muted mt-2">
          {agent === "jordan"
            ? "Jordan responses take ~8 seconds — the agent reasons and uses tools before replying."
            : "Responses may take 10–30 seconds while the agent reasons and uses tools."}
        </p>
      </div>
    </div>
  );
}
