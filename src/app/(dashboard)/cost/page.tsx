export default function CostPage() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-black">Cost</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          API usage and cost tracking — activates when LiteLLM proxy is connected
        </p>
      </div>
      <div className="card text-center py-16">
        <div className="w-10 h-10 bg-brand-offwhite rounded-xl flex items-center justify-center mx-auto mb-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="#C05621" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-brand-black">LiteLLM not yet connected</p>
        <p className="text-xs text-brand-muted mt-2 max-w-sm mx-auto">
          Cost tracking and model routing activate in Phase 2 of the migration.
          All Claude API calls will route through LiteLLM with per-agent cost visibility.
        </p>
      </div>
    </div>
  );
}
