// Server-only. Cursor handling, history processing and bounded re-sync for the Gmail push endpoint.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gmailRead, GmailUserError } from "./gmail-user";
import { classify, loadContactsByEmail, planIngest, applyIngest } from "./ingest";

export const MAX_MESSAGES = 200;
/** Per-run wall-clock budget; the route allows 300s (maxDuration), so stop well before that. */
export const RUN_BUDGET_MS = 240_000;

type SyncRow = { history_id: string | null; watch_expiration: string | null; last_full_sync_at: string | null };

export async function getSyncState(): Promise<SyncRow> {
  const { data, error } = await supabaseAdmin.schema("crm").from("gmail_sync_state").select("history_id,watch_expiration,last_full_sync_at").eq("id", true).single();
  if (error || !data) throw new Error(`gmail_sync_state read failed: ${error?.message ?? "no row"}`);
  return data as SyncRow;
}

export async function updateSyncState(patch: Partial<SyncRow>): Promise<void> {
  const { error } = await supabaseAdmin.schema("crm").from("gmail_sync_state").update(patch).eq("id", true);
  if (error) throw new Error(`gmail_sync_state update failed: ${error.message}`);
}

/**
 * The only way the history cursor moves: crm.advance_gmail_cursor is one atomic UPDATE using
 * greatest(stored, new) numerically, so concurrent or out-of-order runs can never regress it.
 */
export async function advanceCursor(historyId: string, markFullSync = false): Promise<string> {
  const { data, error } = await supabaseAdmin.schema("crm").rpc("advance_gmail_cursor", { p_history_id: historyId, p_mark_full_sync: markFullSync });
  if (error) throw new Error(`advance_gmail_cursor failed: ${error.message}`);
  return data as string;
}

/** Larger of two Gmail history ids, compared numerically (decimal strings, can exceed 2^53). */
export function maxHistoryId(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  try {
    return BigInt(b) > BigInt(a) ? b : a;
  } catch {
    return a;
  }
}

export async function logWorkflow(workflow_name: string, status: "success" | "error" | "pending", error_message: string | null, trigger_text: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("workflow_logs").insert({ workflow_name, status, error_message, trigger_text });
    if (error) console.error("workflow_logs insert failed:", error.message);
  } catch (e) {
    console.error("workflow_logs insert threw:", e instanceof Error ? e.message : e);
    // logging must never break the caller
  }
}

type Reader = ReturnType<typeof gmailRead>;

async function ingestOne(gmail: Reader, id: string): Promise<void> {
  let msg;
  try {
    msg = await gmail.getMessage(id);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return; // deleted before we read it
    throw e;
  }
  const contacts = await loadContactsByEmail(classify(msg).participants);
  await applyIngest(planIngest(msg, contacts), msg);
}

function isHistoryGone(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  const m = e instanceof Error ? e.message : String(e);
  return status === 404 || /too old|invalid.*history|history.*invalid|startHistoryId/i.test(m);
}

/** Failures that affect every message (auth, config, Gmail 5xx), as opposed to one bad message. */
function isSystemic(e: unknown): boolean {
  if (!(e instanceof GmailUserError)) return false;
  return e.code === "auth_failed" || e.code === "not_configured" || (e.status !== undefined && e.status >= 500);
}

/** Ingest ids one by one. A failure (other than a 404) is logged by gmail id only and skipped. */
async function ingestMany(gmail: Reader, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await ingestOne(gmail, id);
    } catch (e) {
      if (isSystemic(e)) throw e; // R28: stop the run, hold the cursor
      const reason = e instanceof Error ? e.message : String(e);
      await logWorkflow("gmail-push", "error", `ingest failed for gmail message ${id}: ${reason}`, `message ${id}`);
    }
  }
}

export async function resyncSince(days: number, pushHistoryId: string, gmail: Reader = gmailRead()): Promise<number> {
  let processed = 0;
  let pageToken: string | undefined;
  do {
    const page = await gmail.listMessages(`newer_than:${days}d`, pageToken);
    const ids = page.ids.slice(0, MAX_MESSAGES - processed);
    await ingestMany(gmail, ids);
    processed += ids.length;
    if (processed >= MAX_MESSAGES && page.nextPageToken) {
      await logWorkflow("gmail-push", "error", `resync truncated at ${MAX_MESSAGES} messages (newer_than:${days}d had more)`, `resync ${days}d`);
      pageToken = undefined;
    } else {
      pageToken = processed >= MAX_MESSAGES ? undefined : page.nextPageToken;
    }
  } while (pageToken);
  await advanceCursor(pushHistoryId, true);
  return processed;
}

/** Handle one Pub/Sub notification. Throws on failure (the route logs and acks). */
export async function processPush(pushHistoryId: string, opts: { now?: () => number; budgetMs?: number } = {}): Promise<{ processed: number; resynced?: boolean }> {
  const state = await getSyncState();
  if (!state.history_id) {
    await advanceCursor(pushHistoryId);
    return { processed: 0 };
  }
  const gmail = gmailRead();
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? RUN_BUDGET_MS);
  const seen = new Set<string>();
  let processed = 0;
  let pageToken: string | undefined;
  let latest = state.history_id; // mailbox-current id from the last page (used when every page completes)
  let lastComplete: string | null = null; // id of the last history record fully processed
  let capped = false;
  try {
    do {
      const page = await gmail.getHistory(state.history_id, pageToken);
      latest = maxHistoryId(latest, page.historyId) ?? latest;
      for (const rec of [...page.records].sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1))) {
        const fresh = rec.messageIds.filter((id) => !seen.has(id));
        // R26: stop before a record that would push us over the cap. A first record bigger than the cap
        // is still taken whole (otherwise the cursor could never move past it).
        if (processed > 0 && (processed + fresh.length > MAX_MESSAGES || now() > deadline)) {
          capped = true;
          break;
        }
        fresh.forEach((id) => seen.add(id));
        await ingestMany(gmail, fresh);
        processed += fresh.length;
        lastComplete = rec.id;
      }
      pageToken = capped ? undefined : page.nextPageToken;
    } while (pageToken);
  } catch (e) {
    if (isHistoryGone(e)) return { processed: await resyncSince(7, pushHistoryId, gmail), resynced: true };
    throw e;
  }
  if (capped) {
    // Resume after the last fully processed record; the next push picks up the rest (applyIngest is idempotent).
    if (lastComplete) await advanceCursor(lastComplete);
    return { processed };
  }
  // Advance only once every page is processed. A page's historyId is the mailbox's *current* id, not the
  // end of that page, so storing it after an early page would skip the later pages if this run died.
  await advanceCursor(latest);
  return { processed };
}
