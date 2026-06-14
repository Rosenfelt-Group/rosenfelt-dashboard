// src/lib/agent-urls.ts
//
// Single source of truth for agent dispatch endpoints. Consumed by
// /api/work/[id]/dispatch and any other route that needs to talk to
// an agent's /webhook/{name}.

export type AgentName = "jordan" | "riley" | "avery" | "casey" | "sam";

export const AGENT_URLS: Record<AgentName, string | undefined> = {
  jordan: process.env.JORDAN_API_URL,
  riley: process.env.RILEY_AGENT_URL,
  avery: process.env.AVERY_AGENT_URL,
  casey: process.env.CASEY_AGENT_URL,
  sam: process.env.SAM_AGENT_URL,
};

export const AGENT_SECRETS: Record<AgentName, string | undefined> = {
  jordan: process.env.JORDAN_WEBHOOK_SECRET,
  riley: process.env.RILEY_WEBHOOK_SECRET,
  avery: process.env.AVERY_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET,
  casey: process.env.CASEY_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET,
  sam: process.env.SAM_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET,
};

export function isAgent(name: string): name is AgentName {
  return ["jordan", "riley", "avery", "casey", "sam"].includes(name);
}

export function dispatchUrl(agent: AgentName): string | null {
  const base = AGENT_URLS[agent];
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/webhook/${agent}`;
}
