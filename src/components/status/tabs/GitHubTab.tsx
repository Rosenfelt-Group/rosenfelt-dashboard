"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { usePolling } from "@/lib/use-polling";
import { EmptyState, LoadingState, Modal } from "@/components/ui";
import { ago, runMeta } from "./helpers";

interface RunLog {
  id: string; source: string; repo: string; workflow_name: string | null;
  external_id: string; status: string; conclusion: string | null;
  branch: string | null; triggered_by: string | null;
  run_url: string | null; started_at: string | null; completed_at: string | null;
}

const REPO_PRIORITY = ["rosenfelt-docs","jordan-agent","riley-agent","avery-agent","casey-agent","rosenfelt-dashboard","website","vps-config","docker-configs","rosenfelt-workflows"];
const HIDDEN_REPOS_STORAGE_KEY = "status_github_hidden_repos";

interface RepoInfo {
  name: string;
  description: string | null;
  html_url: string;
  pushed_at: string | null;
  archived: boolean;
  private: boolean;
  default_branch: string;
}

function GearIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function RepoSettingsModal({
  open, onClose, repos, allNames, hidden, onChange,
}: {
  open: boolean;
  onClose: () => void;
  repos: RepoInfo[];
  allNames: string[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const repoByName = new Map(repos.map(r => [r.name, r]));
  const toggle = (name: string) => {
    const next = new Set(hidden);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(next);
  };
  const showAll = () => onChange(new Set());
  const hideAll = () => onChange(new Set(allNames));

  return (
    <Modal open={open} onClose={onClose} title="Visible repositories" closeOnBackdrop>
      <div className="pb-2 border-b border-brand-border flex items-center gap-3 text-xs">
        <button onClick={showAll} className="text-brand-orange hover:underline">Show all</button>
        <span className="text-brand-muted">·</span>
        <button onClick={hideAll} className="text-brand-muted hover:text-brand-black">Hide all</button>
        <span className="ml-auto text-brand-muted">{repos.length - hidden.size} of {repos.length} visible</span>
      </div>
      <div className="py-2">
        {allNames.map(name => {
          const r = repoByName.get(name);
          return (
            <label key={name} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-brand-offwhite rounded px-1">
              <input
                type="checkbox"
                checked={!hidden.has(name)}
                onChange={() => toggle(name)}
                className="accent-brand-orange"
              />
              <span className="font-mono text-xs text-brand-black flex-1 truncate">{name}</span>
              {r?.archived && <span className="badge text-[9px] px-1 py-0 bg-gray-100 text-gray-500">archived</span>}
              {r && !r.private && <span className="badge text-[9px] px-1 py-0 bg-blue-50 text-blue-700">public</span>}
              {!r && <span className="badge text-[9px] px-1 py-0 bg-amber-50 text-amber-700">runs only</span>}
            </label>
          );
        })}
      </div>
      <div className="pt-2 border-t border-brand-border text-[10px] text-brand-muted">
        Saved per-browser. Hiding a repo removes it from the GitHub tab only.
      </div>
    </Modal>
  );
}

export function GitHubTab() {
  const [runs, setRuns]     = useState<RunLog[]>([]);
  const [repos, setRepos]   = useState<RepoInfo[]>([]);
  const [reposError, setReposError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Hydrate hidden-repos preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HIDDEN_REPOS_STORAGE_KEY);
      if (stored) setHidden(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
  }, []);

  const updateHidden = useCallback((next: Set<string>) => {
    setHidden(next);
    try { localStorage.setItem(HIDDEN_REPOS_STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    const [runsData, reposRes] = await Promise.all([
      fetch("/api/github/runs").then(r => r.json()).catch(() => []),
      fetch("/api/github/repos").then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).catch(e => ({ __error: e instanceof Error ? e.message : String(e) })),
    ]);
    setRuns(Array.isArray(runsData) ? runsData : []);
    if (Array.isArray(reposRes)) {
      setRepos(reposRes);
      setReposError(null);
    } else {
      setRepos([]);
      setReposError(reposRes?.__error ?? reposRes?.message ?? "Failed to load repos");
    }
    setLoading(false);
  }, []);

  // CI runs land from the GitHub webhook; refresh while visible.
  useEffect(() => { load(); }, [load]);
  usePolling(load, 30_000);

  // Merge repos + runs into one ordered list
  const { cards, allNames } = useMemo(() => {
    const runsByRepo = new Map<string, RunLog[]>();
    for (const run of runs) {
      const list = runsByRepo.get(run.repo) ?? [];
      list.push(run);
      runsByRepo.set(run.repo, list);
    }

    // Union of API repos and run-derived repos (handles deleted/renamed repos still in the log).
    const allRepoNames = new Set<string>();
    repos.forEach(r => allRepoNames.add(r.name));
    runsByRepo.forEach((_v, k) => allRepoNames.add(k));

    const sortKey = (name: string) => {
      const i = REPO_PRIORITY.indexOf(name);
      return i === -1 ? REPO_PRIORITY.length : i;
    };

    const allNames = [...allRepoNames].sort((a, b) => {
      const ka = sortKey(a), kb = sortKey(b);
      if (ka !== kb) return ka - kb;
      return a.localeCompare(b);
    });

    const cards = allNames
      .filter(name => !hidden.has(name))
      .map(name => ({
        name,
        info: repos.find(r => r.name === name) ?? null,
        runs: runsByRepo.get(name) ?? [],
      }));

    return { cards, allNames };
  }, [runs, repos, hidden]);

  if (loading) return <LoadingState rows={4} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-brand-muted">
          {cards.length} of {repos.length || runs.length} repos
          {hidden.size > 0 && <span> · {hidden.size} hidden</span>}
          {reposError && <span className="text-red-600 ml-2">· repos: {reposError}</span>}
        </p>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 text-xs text-brand-muted hover:text-brand-black px-2 py-1 rounded hover:bg-brand-offwhite"
          aria-label="Repository visibility settings"
        >
          <GearIcon size={13} />
          <span>Repos</span>
        </button>
      </div>

      {reposError && repos.length === 0 && runs.length === 0 && (
        <div className="card text-sm text-brand-muted text-center py-8 mb-4">
          <p className="text-brand-black font-medium mb-1">Repository list unavailable</p>
          <p className="text-xs">Set <code className="bg-brand-offwhite px-1 rounded">GITHUB_API_TOKEN</code> in Vercel to list all repositories. Workflow runs will still appear here when triggered.</p>
        </div>
      )}

      {cards.length === 0 ? (
        <EmptyState
          title={
            <>
              No repositories to show.{" "}
              {hidden.size > 0 && (
                <button onClick={() => updateHidden(new Set())} className="text-brand-orange hover:underline">Show all</button>
              )}{" "}or{" "}
              <button onClick={() => setSettingsOpen(true)} className="text-brand-orange hover:underline">open settings</button>.
            </>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map(({ name, info, runs: repoRuns }) => {
            const latest = repoRuns[0] ?? null;
            const meta = latest ? runMeta(latest.status, latest.conclusion) : null;
            const history = repoRuns.slice(1, 6);
            return (
              <div key={name} className="card">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted flex-shrink-0">
                      <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
                      <path d="M18 9a9 9 0 0 1-9 9"/><path d="M6 9a9 9 0 0 0 3.6 7.2"/>
                    </svg>
                    {info ? (
                      <a href={info.html_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-black font-mono truncate hover:text-brand-orange">{name}</a>
                    ) : (
                      <h3 className="text-sm font-semibold text-brand-black font-mono truncate">{name}</h3>
                    )}
                    {info?.archived && <span className="badge text-[9px] px-1 py-0 bg-gray-100 text-gray-500 flex-shrink-0">archived</span>}
                  </div>
                  {meta ? (
                    <span className={clsx("badge text-[10px] px-1.5 py-0.5 flex-shrink-0", meta.badge)}>{meta.label}</span>
                  ) : (
                    <span className="badge text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 flex-shrink-0">No runs</span>
                  )}
                </div>

                {info?.description && (
                  <p className="text-[10px] text-brand-muted mb-1 line-clamp-1">{info.description}</p>
                )}

                {info?.pushed_at && (
                  <p className="text-[10px] text-brand-muted mb-1">
                    pushed to <span className="font-mono">{info.default_branch ?? "main"}</span> {ago(info.pushed_at)}
                  </p>
                )}

                {latest && meta ? (
                  <>
                    <div className="flex items-center gap-3 py-2.5">
                      <div className={clsx("w-2 h-2 rounded-full flex-shrink-0", meta.dot)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-brand-black">{latest.workflow_name ?? "Workflow"}</p>
                        <p className="text-[10px] text-brand-muted mt-0.5">
                          {latest.branch && <span className="font-mono">{latest.branch}</span>}
                          {latest.triggered_by && <span> · {latest.triggered_by}</span>}
                          {ago(latest.status === "completed" ? latest.completed_at : latest.started_at) && (
                            <span> · {ago(latest.status === "completed" ? latest.completed_at : latest.started_at)}</span>
                          )}
                        </p>
                      </div>
                      {latest.run_url && (
                        <a href={latest.run_url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-brand-muted hover:text-brand-black">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </a>
                      )}
                    </div>
                    {history.length > 0 && (
                      <div className="border-t border-brand-border divide-y divide-brand-border">
                        {history.map(run => {
                          const m = runMeta(run.status, run.conclusion);
                          return (
                            <div key={run.id} className="flex items-center gap-3 py-2">
                              <div className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", m.dot)} />
                              <span className="text-[10px] text-brand-muted flex-1 truncate">{run.workflow_name ?? "Workflow"}</span>
                              <span className="text-[10px] text-brand-muted flex-shrink-0">{ago(run.status === "completed" ? run.completed_at : run.started_at)}</span>
                              {run.run_url && (
                                <a href={run.run_url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-brand-muted hover:text-brand-black">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                                  </svg>
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-3 text-center">
                    <p className="text-xs text-brand-muted">No CI configured</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <RepoSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        repos={repos}
        allNames={allNames}
        hidden={hidden}
        onChange={updateHidden}
      />
    </div>
  );
}
