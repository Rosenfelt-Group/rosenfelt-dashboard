import { supabaseAdmin } from "@/lib/supabase-admin";

// Server-only. Store for Postmark webhook events (public.email_events) and the audit log (public.email_actions).

export type EmailEvent = {
  id: string;
  event_key: string;
  record_type: "Bounce" | "SpamComplaint" | "SubscriptionChange" | "Delivery";
  message_id: string | null;
  recipient: string;
  subject: string | null;
  tag: string | null;
  source_group: string;
  bounce_type: string | null;
  description: string | null;
  inactive: boolean | null;
  can_activate: boolean | null;
  metadata: Record<string, string>;
  occurred_at: string;
  received_at: string;
  payload: unknown;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: "unblocked" | "resent" | "dismissed" | null;
};

// What the problems list sends to the browser: no payload (raw webhook body) and no metadata.
export const PROBLEM_COLUMNS = [
  "id", "record_type", "recipient", "subject", "tag", "source_group", "bounce_type", "description", "inactive",
  "occurred_at", "resolved_at", "resolution",
] as const;
export type EmailProblem = Pick<EmailEvent, (typeof PROBLEM_COLUMNS)[number]>;

export type EmailAction = "unblock" | "block" | "dismiss" | "resend";

const db = () => supabaseAdmin.schema("public");

// Problems are rows that stopped mail: hard bounces and blocks (inactive = true; for a SubscriptionChange that is
// Postmark's SuppressSending) and spam complaints. Soft bounces and reactivations are stored but never listed.
export async function listProblems(opts: { since: string; includeResolved?: boolean }): Promise<EmailProblem[]> {
  let q = db().from("email_events").select(PROBLEM_COLUMNS.join(", "))
    .neq("record_type", "Delivery").or("inactive.is.true,record_type.eq.SpamComplaint").gte("occurred_at", opts.since);
  if (!opts.includeResolved) q = q.is("resolved_at", null);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(200);
  if (error) throw new Error(`email_events list failed: ${error.message}`);
  return (data ?? []) as unknown as EmailProblem[];
}

export async function getEvent(id: string): Promise<EmailEvent | null> {
  const { data, error } = await db().from("email_events").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`email_events get failed: ${error.message}`);
  return (data as EmailEvent | null) ?? null;
}

export async function windowCounts(since: string): Promise<{
  delivered: number; unresolvedHardBounces: number; unresolvedSpam: number; events: number;
}> {
  const count = async (label: string, build: (q: ReturnType<typeof base>) => unknown): Promise<number> => {
    const { count: n, error } = (await build(base())) as { count: number | null; error: { message: string } | null };
    if (error) throw new Error(`email_events ${label} count failed: ${error.message}`);
    return n ?? 0;
  };
  const base = () => db().from("email_events").select("id", { count: "exact", head: true }).gte("occurred_at", since);
  const [delivered, unresolvedHardBounces, unresolvedSpam, events] = await Promise.all([
    count("delivered", (q) => q.eq("record_type", "Delivery")),
    count("hard bounce", (q) => q.eq("record_type", "Bounce").eq("inactive", true).is("resolved_at", null)),
    count("spam", (q) => q.eq("record_type", "SpamComplaint").is("resolved_at", null)),
    count("total", (q) => q),
  ]);
  return { delivered, unresolvedHardBounces, unresolvedSpam, events };
}

// Marks unresolved problem rows resolved; returns how many changed. Recipient matching is case-insensitive.
export async function resolveEvents(
  filter: { id?: string; recipient?: string },
  resolution: "unblocked" | "resent" | "dismissed",
  by: string,
): Promise<number> {
  if (!filter.id && !filter.recipient) return 0;
  let q = db().from("email_events")
    .update({ resolved_at: new Date().toISOString(), resolved_by: by, resolution })
    .is("resolved_at", null);
  if (filter.id) q = q.eq("id", filter.id);
  // Anchored, regex-escaped imatch: exact + case-insensitive. (ilike would treat PostgREST's `*` as a wildcard.)
  if (filter.recipient) q = q.filter("recipient", "imatch", `^${filter.recipient.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`email_events resolve failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function logAction(a: {
  action: EmailAction; recipient?: string; eventId?: string; detail?: Record<string, unknown>; by: string;
}): Promise<void> {
  try {
    const { error } = await db().from("email_actions").insert({
      action: a.action, recipient: a.recipient ?? null, event_id: a.eventId ?? null,
      detail: a.detail ?? {}, performed_by: a.by,
    });
    if (error) console.error("email_actions insert failed:", error.message);
  } catch (e) {
    console.error("email_actions insert failed:", e);
  }
}
