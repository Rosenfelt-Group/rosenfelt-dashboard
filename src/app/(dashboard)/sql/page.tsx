import { SupabaseSqlQuery } from "@/components/engineering/SupabaseSqlQuery";

export default function SqlPage() {
  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-brand-black">SQL Query</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          Run queries against the Rosably Supabase database — Tab to autocomplete, ⌘S to save
        </p>
      </div>
      <SupabaseSqlQuery />
    </div>
  );
}
