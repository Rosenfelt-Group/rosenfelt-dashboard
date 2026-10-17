"use client";
import { useEffect, useState } from "react";
import { PageHeader, Tabs } from "@/components/ui";
import WebsitePanel from "@/components/status/WebsitePanel";
import PatchStatusPanel from "@/components/status/PatchStatusPanel";
import { AgentsTab } from "@/components/status/tabs/AgentsTab";
import { GitHubTab } from "@/components/status/tabs/GitHubTab";
import { VercelTab } from "@/components/status/tabs/VercelTab";
import { SupabaseTab } from "@/components/status/tabs/SupabaseTab";
import { VpsTab } from "@/components/status/tabs/VpsTab";
import { N8nTab } from "@/components/status/tabs/N8nTab";
import { WordpressTab } from "@/components/status/tabs/WordpressTab";
import { AuditTab } from "@/components/status/tabs/AuditTab";

type Tab = "agents" | "github" | "vercel" | "supabase" | "vps" | "n8n" | "wordpress" | "audit" | "website" | "patches";

const TABS: { id: Tab; label: string }[] = [
  { id: "agents",     label: "Agents"     },
  { id: "github",     label: "GitHub"     },
  { id: "vercel",     label: "Vercel"     },
  { id: "supabase",   label: "Supabase"   },
  { id: "vps",        label: "VPS"        },
  { id: "n8n",        label: "n8n"        },
  { id: "wordpress",  label: "WordPress"  },
  { id: "audit",      label: "Audit"      },
  { id: "website",    label: "Website"    },
  { id: "patches",    label: "Patches"    },
];

export default function StatusPage() {
  const [tab, setTab] = useState<Tab>("agents");
  // Tabs mount the first time they're selected and then stay mounted (hidden),
  // so each one only starts fetching/polling once it has been opened.
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set<Tab>(["agents"]));
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => (r.ok ? r.json() : null))
      .then(d => setIsAdmin(d?.role === "admin"))
      .catch(() => setIsAdmin(false));
  }, []);

  const selectTab = (id: Tab) => {
    setTab(id);
    setVisited(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  const panel = (id: Tab, content: React.ReactNode) =>
    visited.has(id) && (
      <div key={id} role="tabpanel" className={tab === id ? "block" : "hidden"}>{content}</div>
    );

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-5xl mx-auto">
      <PageHeader
        title="Status"
        description="Service health and deployment history"
        actions={
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-brand-muted">Auto-refreshing</span>
          </div>
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={selectTab} className="mb-6" />

      {/* Tab content — mounted on first visit, then hidden when inactive */}
      {panel("agents",    <AgentsTab />)}
      {panel("github",    <GitHubTab />)}
      {panel("vercel",    <VercelTab />)}
      {panel("supabase",  <SupabaseTab />)}
      {panel("vps",       <VpsTab />)}
      {panel("n8n",       <N8nTab />)}
      {panel("wordpress", <WordpressTab />)}
      {panel("audit",     <AuditTab isAdmin={isAdmin} />)}
      {panel("website",   <WebsitePanel isAdmin={isAdmin} />)}
      {panel("patches",   <PatchStatusPanel isAdmin={isAdmin} />)}
    </div>
  );
}
