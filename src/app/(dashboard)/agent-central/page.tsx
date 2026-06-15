"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow } from "date-fns";
import type { AgentStatus } from "@/types";

// Static agent config — source of truth for tool counts and roles
const AGENTS = [
  {
    name: "jordan" as const,
    port: 8001,
    label: "Jordan",
    role: "Deploy · SSH · WordPress · n8n",
    tools: 61,
    chatHref: "/chat?agent=jordan",
  },
  {
    name: "riley" as const,
    port: 8002,
    label: "Riley",
    role: "Tasks · Memory · Weekly digest",
    tools: 30,
    chatHref: "/chat?agent=riley",
  },
  {
    name: "avery" as const,
    port: 8003,
    label: "Avery",
    role: "Content · Audits · Research",
    tools: 32,
    chatHref: "/chat?agent=avery",
  },
  {
    name: "casey" as const,
    port: 8004,
    label: "Casey",
    role: "Audit · Regression · Health checks",
    tools: 36,
    chatHref: null,
  },
  {
    name: "sam" as const,
    port: 8005,
    label: "Sam",
    role: "Accounting · Legal · HR",
    tools: 25,
    chatHref: "/chat?agent=sam",
  },
] as const;

export default function AgentCentralPage() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus[]>([]);
  const [loading, setLoading]         = useState(true);

  const load = useCallback(async () => {
    const data = await fetch("/api/agent-status")
      .then(r => r.json())
      .catch(() => []);
    setAgentStatus(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  function statusFor(name: string): AgentStatus | undefined {
    return agentStatus.find(a => a.agent === name);
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-brand-black">Agent Central</h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/agents/history"
            className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
            History →
          </Link>
          <Link href="/agents/intelligence"
            className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
            Intelligence →
          </Link>
          <Link href="/work"
            className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
            Work board →
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENTS.map(a => <div key={a.name} className="card animate-pulse h-36" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENTS.map(a => {
            const s = statusFor(a.name);
            const hasError = (s?.errors_24h ?? 0) > 0;
            return (
              <div key={a.name} className="card p-4 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <AgentBadge agent={a.name} />
                    <div>
                      <p className="text-sm font-semibold text-brand-black">{a.label}</p>
                      <p className="text-xs text-brand-muted">port {a.port} · {a.tools} tools</p>
                    </div>
                  </div>
                  <div className={clsx(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    hasError ? "bg-amber-400" : "bg-green-400"
                  )} />
                </div>

                {/* Role */}
                <p className="text-xs text-brand-muted">{a.role}</p>

                {/* 24h stats */}
                {s && (
                  <div className="flex gap-4 text-xs">
                    <span className="text-brand-muted">
                      <span className="text-brand-black font-medium">{s.executions_24h}</span> executions
                    </span>
                    {s.errors_24h > 0 && (
                      <span className="text-red-600">
                        <span className="font-medium">{s.errors_24h}</span> errors
                      </span>
                    )}
                  </div>
                )}
                {s?.last_execution && (
                  <p className="text-[10px] text-brand-muted">
                    Last: {formatDistanceToNow(new Date(s.last_execution), { addSuffix: true })}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-auto pt-1">
                  {a.chatHref ? (
                    <Link href={a.chatHref}
                      className="flex-1 text-center text-xs py-1.5 rounded-lg bg-brand-orange text-white hover:bg-brand-orange/90 transition-colors font-medium">
                      Chat
                    </Link>
                  ) : (
                    <span className="flex-1 text-center text-xs py-1.5 rounded-lg bg-brand-offwhite text-brand-muted">
                      No chat
                    </span>
                  )}
                  <Link href={`/agents/history?agent=${a.name}`}
                    className="flex-1 text-center text-xs py-1.5 rounded-lg border border-brand-border text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
                    History
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Agent prompts shortcut */}
      <div className="mt-6">
        <div className="card p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-brand-black">Agent Prompts</p>
            <p className="text-xs text-brand-muted mt-0.5">
              Edit live system prompts — changes take effect on next message
            </p>
          </div>
          <Link href="/agents/agent-prompts"
            className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors flex-shrink-0">
            Edit prompts →
          </Link>
        </div>
      </div>
    </div>
  );
}
