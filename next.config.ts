import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages retired in the 2026-10-17 nav cleanup; keep old bookmarks working.
  async redirects() {
    return [
      { source: "/cost",    destination: "/finance?tab=cost",   permanent: false },
      { source: "/billing", destination: "/finance?tab=stripe", permanent: false },
      { source: "/sales",   destination: "/content/research",   permanent: false },
      { source: "/backup",  destination: "/tools",              permanent: false },
      // 2026-10-17 merges (work item #1316)
      { source: "/control-center",      destination: "/overview",                  permanent: false },
      { source: "/agent-central",       destination: "/agents",                    permanent: false },
      { source: "/agents/history",      destination: "/agents?tab=activity",       permanent: false },
      { source: "/agents/intelligence", destination: "/agents/jordan?tab=prompts", permanent: false },
      { source: "/chat",                destination: "/agents/jordan?tab=chat",    permanent: false },
      { source: "/crm/leads",           destination: "/crm?view=list",             permanent: false },
      { source: "/quiz",                destination: "/analytics?tab=quiz",        permanent: false },
      { source: "/images",              destination: "/documents?tab=images",      permanent: false },
      { source: "/users",               destination: "/tools?tab=users",           permanent: false },
      { source: "/rbac",                destination: "/tools?tab=roles",           permanent: false },
      { source: "/sql",                 destination: "/tools?tab=sql",             permanent: false },
      { source: "/engineering",         destination: "/tools?tab=terminal",        permanent: false },
      // 2026-10-24 CRM refresh: setup pages moved into CRM settings. Exact paths
      // only, so /crm/discovery/templates/[id] (the template editor) still works.
      { source: "/crm/admin/services",       destination: "/crm/settings?tab=services",  permanent: false },
      { source: "/crm/discovery/questions",  destination: "/crm/settings?tab=questions", permanent: false },
      { source: "/crm/discovery/templates",  destination: "/crm/settings?tab=templates", permanent: false },
    ];
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
