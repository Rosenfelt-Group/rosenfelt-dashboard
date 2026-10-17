"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { ago, vercelStateMeta } from "./helpers";

interface VercelDeployment {
  uid: string; name: string; url: string; state: string;
  created: number; ready: number | null;
  meta: { githubCommitMessage?: string; githubCommitRef?: string; githubCommitSha?: string };
  creator?: { username?: string };
}

export function VercelTab() {
  const [deployments, setDeployments] = useState<VercelDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/vercel/deployments");
    if (!res.ok) { setError(`Failed to load (${res.status})`); setLoading(false); return; }
    const data = await res.json();
    setDeployments(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <LoadingState />;
  if (error)   return <ErrorState message={error} />;
  if (deployments.length === 0) return <EmptyState title="No deployments found." />;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
        <p className="text-sm font-semibold text-brand-black font-mono">rosenfelt-dashboard</p>
        <p className="text-xs text-brand-muted">dashboard.rosably.com</p>
      </div>
      {deployments.map((d, i) => {
        const meta = vercelStateMeta(d.state);
        const msg  = d.meta?.githubCommitMessage?.split("\n")[0] ?? "—";
        const ref  = d.meta?.githubCommitRef ?? "—";
        const url  = `https://${d.url}`;
        return (
          <div key={d.uid} className={clsx("flex items-center gap-3 px-4 py-3 text-sm", i !== 0 && "border-t border-brand-border")}>
            <span className={clsx("badge text-[10px] px-1.5 py-0.5 flex-shrink-0", meta.badge)}>{meta.label}</span>
            <div className="flex-1 min-w-0">
              <p className="text-brand-black truncate text-xs font-medium">{msg}</p>
              <p className="text-[10px] text-brand-muted mt-0.5 font-mono">{ref}</p>
            </div>
            <span className="text-[10px] text-brand-muted flex-shrink-0 whitespace-nowrap">{ago(d.created)}</span>
            <a href={url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-brand-muted hover:text-brand-black">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>
        );
      })}
    </div>
  );
}
