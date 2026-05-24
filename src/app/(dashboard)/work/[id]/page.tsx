import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { WorkItem } from "@/types";
import { WorkItemDetail } from "./WorkItemDetail";

export const dynamic = "force-dynamic";

export default async function WorkItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("work_items")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return notFound();
  return <WorkItemDetail initial={data as WorkItem} />;
}
