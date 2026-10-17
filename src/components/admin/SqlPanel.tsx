import { SupabaseSqlQuery } from "@/components/engineering/SupabaseSqlQuery";

/** SQL runner against the Rosably Supabase database. */
export function SqlPanel() {
  return (
    <div className="max-w-5xl">
      <p className="text-sm text-brand-muted mb-4">
        Run queries against the Rosably Supabase database — Tab to autocomplete, ⌘S to save
      </p>
      <SupabaseSqlQuery />
    </div>
  );
}
