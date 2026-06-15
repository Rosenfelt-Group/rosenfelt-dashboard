import Link from "next/link";

const TOOLS = [
  {
    label: "Backup",
    href: "/backup",
    icon: "M21 8 21 21 3 21 3 8M1 3h22v5H1zM10 12h4",
    desc: "VPS backup and restore",
  },
  {
    label: "Users",
    href: "/users",
    icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    desc: "Dashboard user accounts",
  },
  {
    label: "Roles (RBAC)",
    href: "/rbac",
    icon: "M3 11V7a5 5 0 0 1 10 0v4M5 11h14v11H5z",
    desc: "Permission roles and assignments",
  },
  {
    label: "SQL Runner",
    href: "/sql",
    icon: "M12 5a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V8a3 3 0 0 0-3-3zM3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M21 12c0 1.66-4 3-9 3s-9-1.34-9-3",
    desc: "Run queries against Supabase",
  },
  {
    label: "Terminal",
    href: "/engineering",
    icon: "M4 17 10 11 4 5M12 19h8",
    desc: "Jordan SSH terminal",
  },
  {
    label: "Agent Prompts",
    href: "/agents/intelligence",
    icon: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z",
    desc: "Edit live agent system prompts",
  },
];

export default function ToolsPage() {
  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <h1 className="text-xl font-semibold text-brand-black mb-6">Tools</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map(tool => (
          <Link
            key={tool.href}
            href={tool.href}
            className="card flex items-start gap-4 p-5 hover:border-brand-orange/40 hover:shadow-sm transition-all group"
          >
            <div className="p-2.5 rounded-xl bg-brand-offwhite group-hover:bg-orange-50 transition-colors flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                   className="text-brand-muted group-hover:text-brand-orange transition-colors">
                <path d={tool.icon}/>
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-black group-hover:text-brand-orange transition-colors">
                {tool.label}
              </p>
              <p className="text-xs text-brand-muted mt-0.5 leading-relaxed">{tool.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
