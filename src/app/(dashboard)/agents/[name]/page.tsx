import { notFound } from "next/navigation";
import { isAgentName } from "@/lib/agents";
import { AgentDetail } from "./agent-detail";

export default async function AgentPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!isAgentName(name)) notFound();
  return <AgentDetail agent={name} />;
}
