import { SupabaseSqlQuery } from "@/components/engineering/SupabaseSqlQuery";
import { PageHeader } from "@/components/ui";

export default function SqlPage() {
  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-5xl">
      <PageHeader
        title="SQL Query"
        description="Run queries against the Rosably Supabase database — Tab to autocomplete, ⌘S to save"
      />
      <SupabaseSqlQuery />
    </div>
  );
}
