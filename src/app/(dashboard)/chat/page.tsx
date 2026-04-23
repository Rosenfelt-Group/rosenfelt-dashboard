"use client";
import { useState, useEffect, useRef } from "react";
import { AgentBadge } from "@/components/AgentBadge";
import { Agent } from "@/types";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";

type Message = {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

const AGENTS: { id: Agent; label: string; available: boolean; note?: string }[] = [
  { id: "jordan", label: "Jordan", available: true },
  { id: "riley",  label: "Riley",  available: true },
  { id: "avery",  label: "Avery",  available: true },
];

const AGENT_PROMPTS: Partial<Record<Agent, string>> = {
  jordan: "Ask about workflows, containers, VPS status, or tasks.",
  avery: "Ask Avery to draft blog posts, research topics, or manage content.",
  riley: "Ask Riley about CRM data, leads, or client activity.",
};

const CHAT_ID = "dashboard_brian";

function MessageBubble({ msg, agent }: { msg: Message; agent: Agent }) {
  const isUser = msg.role === "user";

  const formatted = msg.content
    .replace(/<b>(.*?)<\/b>/g, "$1")
    .replace(/<i>(.*?)<\/i>/g, "$1")
    .replace(/<code>(.*?)<\/code>/g, "`$1`");

  return (
    <div className={clsx("flex gap-3 max-w-3xl", isUser ? "ml-auto flex-row-reverse" : "")}>
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <AgentBadge agent={agent} />
        </div>
      )}
      <div className={clsx(
        "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap max-w-xl",
        isUser
          ? "bg-brand-orange text-white rounded-tr-sm"
          : "bg-white border border-brand-border text-brand-black rounded-tl-sm"
      )}>
        {formatted}
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

export default function ChatPage() {
  const [agent, setAgent] = useState<Agent>("jordan");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history when agent changes
  useEffect(() => {
    setLoadingHistory(true);
    setMessages([]);
    fetch(`/api/chat?agent=${agent}&chatId=${CHAT_ID}`)
      .then(r => r.json())
      .then(data => {
        setMessages(Array.isArray(data) ? data : []);
        setLoadingHistory(false);
      })
      .catch(() => setLoadingHistory(false));
  }, [agent]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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

  const selectedAgent = AGENTS.find(a => a.id === agent)!;

  return (
    <div className="flex flex-col h-screen ml-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-brand-border flex-shrink-0">
        <div>
          <h1 className="text-base font-semibold text-brand-black">Agent Chat</h1>
          <p className="text-xs text-brand-muted mt-0.5">Dashboard interface — history saved to Supabase</p>
        </div>

        {/* Agent selector */}
        <div className="flex gap-2">
          {AGENTS.map(a => (
            <button
              key={a.id}
              onClick={() => a.available && setAgent(a.id)}
              title={a.note}
              className={clsx(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors",
                a.available
                  ? agent === a.id
                    ? "bg-brand-orange text-white"
                    : "bg-brand-offwhite text-brand-black hover:bg-brand-border"
                  : "bg-brand-offwhite text-brand-muted cursor-not-allowed opacity-50"
              )}
            >
              <AgentBadge agent={a.id} size="sm" />
              {a.label}
              {!a.available && <span className="text-xs">({a.note})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 bg-brand-offwhite">
        {loadingHistory ? (
          <div className="text-center text-sm text-brand-muted py-8">Loading history...</div>
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
      <div className="px-6 py-4 bg-white border-t border-brand-border flex-shrink-0">
        <div className="flex gap-3 items-end max-w-3xl">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedAgent.available
              ? `Message ${selectedAgent.label}... (Enter to send, Shift+Enter for newline)`
              : `${selectedAgent.label} is not yet available`}
            disabled={!selectedAgent.available || loading}
            rows={1}
            className="flex-1 resize-none border border-brand-border rounded-xl px-4 py-3 text-sm
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
            disabled={!input.trim() || loading || !selectedAgent.available}
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
