import clsx from "clsx";
import { Agent } from "@/types";

const config: Record<Agent, { label: string; color: string }> = {
  riley:  { label: "RI", color: "bg-green-100 text-green-700" },
  jordan: { label: "JO", color: "bg-amber-100 text-amber-700" },
  avery:  { label: "AV", color: "bg-blue-100 text-blue-700" },
  brian:  { label: "BR", color: "bg-orange-100 text-brand-orange" },
  sam:    { label: "SA", color: "bg-purple-100 text-purple-700" },
};

export function AgentBadge({ agent, size = "md" }: { agent: Agent; size?: "sm" | "md" }) {
  const { label, color } = config[agent] ?? config.brian;
  return (
    <span className={clsx(
      "inline-flex items-center justify-center rounded-full font-medium flex-shrink-0",
      color,
      size === "sm" ? "w-5 h-5 text-xs" : "w-7 h-7 text-xs"
    )}>
      {label}
    </span>
  );
}

export function AgentName({ agent }: { agent: Agent }) {
  const names: Record<Agent, string> = {
    riley: "Riley", jordan: "Jordan", avery: "Avery", brian: "Brian", sam: "Sam"
  };
  return <span className="capitalize">{names[agent] ?? agent}</span>;
}
