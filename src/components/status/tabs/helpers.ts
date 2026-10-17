// Pure formatting/parsing helpers shared by the status page tabs.
import { formatDistanceToNow, parseISO } from "date-fns";
import type { EmailEvent } from "@/lib/email/events";

export function ago(ts: string | number | null) {
  if (!ts) return null;
  try {
    const d = typeof ts === "number" ? new Date(ts) : parseISO(ts as string);
    return formatDistanceToNow(d, { addSuffix: true });
  } catch { return null; }
}

export function runMeta(status: string, conclusion: string | null) {
  if (status === "in_progress") return { label: "Running",   dot: "bg-amber-400 animate-pulse", badge: "bg-amber-50 text-amber-700"  };
  if (status === "queued")      return { label: "Queued",    dot: "bg-gray-300",                badge: "bg-gray-100 text-gray-500"   };
  if (conclusion === "success") return { label: "Success",   dot: "bg-green-500",               badge: "bg-green-50 text-green-700"  };
  if (conclusion === "failure") return { label: "Failed",    dot: "bg-red-500",                 badge: "bg-red-50 text-red-700"      };
  return                               { label: conclusion ?? status, dot: "bg-gray-300",       badge: "bg-gray-100 text-gray-500"   };
}

export function vercelStateMeta(state: string) {
  if (state === "READY")    return { label: "Ready",    badge: "bg-green-50 text-green-700" };
  if (state === "ERROR")    return { label: "Error",    badge: "bg-red-50 text-red-700"     };
  if (state === "BUILDING") return { label: "Building", badge: "bg-amber-50 text-amber-700" };
  if (state === "QUEUED")   return { label: "Queued",   badge: "bg-gray-100 text-gray-500"  };
  if (state === "CANCELED") return { label: "Cancelled",badge: "bg-gray-100 text-gray-500"  };
  return                           { label: state,      badge: "bg-gray-100 text-gray-500"  };
}

export function supabaseIndicatorMeta(indicator: string) {
  if (indicator === "none")     return { label: "All Systems Operational", cls: "text-green-700 bg-green-50", dot: "bg-green-500" };
  if (indicator === "minor")    return { label: "Minor Disruption",        cls: "text-amber-700 bg-amber-50", dot: "bg-amber-400" };
  if (indicator === "major")    return { label: "Major Outage",            cls: "text-red-700 bg-red-50",     dot: "bg-red-500"   };
  if (indicator === "critical") return { label: "Critical Outage",         cls: "text-red-700 bg-red-50",     dot: "bg-red-500 animate-pulse" };
  return                                { label: indicator,                cls: "text-gray-700 bg-gray-100",  dot: "bg-gray-400"  };
}

export function componentStatusDot(status: string) {
  if (status === "operational")         return "bg-green-500";
  if (status === "degraded_performance") return "bg-amber-400";
  if (status === "partial_outage")      return "bg-orange-500";
  if (status === "major_outage")        return "bg-red-500";
  return "bg-gray-300";
}

export function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// WP REST returns titles with HTML entities (e.g. "It&#8217;s"). Decode named + numeric
// entities to plain text without touching the DOM (avoids any innerHTML surface).
const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™",
};
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => HTML_NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

// Plain-English name for a Postmark tag ("n8n-stripe-buyer" -> "n8n · stripe-buyer").
export function sourceLabel(tag: string | null): string {
  if (!tag) return "Other";
  if (tag === "dashboard-room-invite") return "Dashboard · room invite";
  if (tag === "dashboard-discovery-invite") return "Dashboard · discovery invite";
  if (tag.startsWith("n8n-")) return `n8n · ${tag.slice(4)}`;
  if (tag === "wordpress") return "WordPress";
  return "Other";
}

export function problemLabel(e: EmailEvent): string {
  if (e.record_type === "Bounce") return e.description ? `Hard bounce: ${e.description}` : "Hard bounce";
  if (e.record_type === "SpamComplaint") return "Spam complaint";
  return "Blocked";
}
