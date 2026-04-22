export default function BackupPage() {
  const targets = [
    { label: "Agent docs",     path: "/opt/rosenfelt/docs",   description: "Markdown knowledge base and agent reference files" },
    { label: "Agent code",     path: "/opt/rosenfelt/agents", description: "n8n workflows, Python scripts, prompt files" },
    { label: "Website",        path: "WordPress export",      description: "Full WP XML + media library export" },
    { label: "Supabase data",  path: "supabase dump",         description: "All tables: tasks, leads, conversations, memory" },
    { label: "Dashboard code", path: "git repo",              description: "This Next.js dashboard — push to GitHub" },
  ];

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-black">Backup</h1>
        <p className="text-sm text-brand-muted mt-0.5">Backup targets — automation coming in a future phase</p>
      </div>

      <div className="space-y-3">
        {targets.map(t => (
          <div key={t.label} className="card flex items-start gap-4 opacity-60">
            <div className="w-9 h-9 bg-brand-offwhite rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-brand-muted">
                <polyline points="21 8 21 21 3 21 3 8"/>
                <rect x="1" y="3" width="22" height="5"/>
                <line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-brand-black">{t.label}</p>
              <p className="text-xs text-brand-muted mt-0.5">{t.description}</p>
              <p className="text-xs text-brand-muted mt-1 font-mono">{t.path}</p>
            </div>
            <span className="text-xs px-2 py-1 rounded bg-brand-offwhite text-brand-muted flex-shrink-0">
              Not configured
            </span>
          </div>
        ))}
      </div>

      <div className="card mt-6 bg-amber-50 border-amber-200">
        <p className="text-xs text-amber-700 font-medium mb-1">Phase 2 placeholder</p>
        <p className="text-xs text-amber-600">
          Automated backup scheduling, S3/Backblaze upload, and restore from backup will be wired up here.
        </p>
      </div>
    </div>
  );
}
