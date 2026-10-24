// Pure agent metadata + URL helpers for the /agents area. No env access, safe
// to import from client components and tests.

export type AgentName = "jordan" | "riley" | "avery" | "casey" | "sam";

export type AgentInfo = {
  name: AgentName;
  label: string;
  role: string;
  port: number;
  tools: number;
  /** Has a dashboard chat. Casey does not: it only builds prototypes. */
  chat: boolean;
};

export const AGENT_LIST: readonly AgentInfo[] = [
  { name: "jordan", label: "Jordan", role: "Deploy · SSH · WordPress · n8n",     port: 8001, tools: 61, chat: true },
  { name: "riley",  label: "Riley",  role: "Tasks · Memory · Weekly digest",     port: 8002, tools: 30, chat: true },
  { name: "avery",  label: "Avery",  role: "Content · Audits · Research",        port: 8003, tools: 32, chat: true },
  { name: "casey",  label: "Casey",  role: "Design and prototypes",              port: 8004, tools: 51, chat: false },
  { name: "sam",    label: "Sam",    role: "Accounting · Legal · HR",            port: 8005, tools: 25, chat: true },
];

export const AGENT_NAMES: readonly AgentName[] = AGENT_LIST.map(a => a.name);

export function isAgentName(name: unknown): name is AgentName {
  return typeof name === "string" && (AGENT_NAMES as readonly string[]).includes(name);
}

export function getAgentInfo(name: AgentName): AgentInfo {
  return AGENT_LIST.find(a => a.name === name)!;
}

/** Tabs on /agents. */
export const AGENTS_INDEX_TABS = ["agents", "activity"] as const;
export type AgentsIndexTab = (typeof AGENTS_INDEX_TABS)[number];

/** Tabs on /agents/[name]. */
export const AGENT_DETAIL_TABS = ["status", "history", "chat", "prompts"] as const;
export type AgentDetailTab = (typeof AGENT_DETAIL_TABS)[number];

/** Returns `raw` if it is one of `allowed`, else the first allowed tab. */
export function parseTab<T extends string>(raw: string | null | undefined, allowed: readonly T[]): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : allowed[0];
}
