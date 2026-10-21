// Server-only. Cursor handling, history processing and bounded re-sync for the Gmail push endpoint.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gmailRead } from "./gmail-user";
import { classify, loadContactsByEmail, planIngest, applyIngest } from "./ingest";

export const MAX_MESSAGES = 200;

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
    await supabaseAdmin.from("workflow_logs").insert({ workflow_name, status, error_message, trigger_text });
  } catch {
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

/** Process up to `budget` ids; returns how many were processed and the first error, if any. */
async function ingestMany(gmail: Reader, ids: string[], budget: number): Promise<{ done: number; capped: boolean; error?: unknown }> {
  let done = 0;
  let error: unknown;
  for (const id of ids) {
    if (done >= budget) return { done, capped: true, error };
    try {
      await ingestOne(gmail, id);
    } catch (e) {
      error ??= e;
    }
    done++;
  }
  return { done, capped: false, error };
}

export async function resyncSince(days: number, pushHistoryId: string, gmail: Reader = gmailRead()): Promise<number> {
  let processed = 0;
  let pageToken: string | undefined;
  let error: unknown;
  do {
    const page = await gmail.listMessages(`newer_than:${days}d`, pageToken);
    const r = await ingestMany(gmail, page.ids, MAX_MESSAGES - processed);
    processed += r.done;
    error ??= r.error;
    pageToken = r.capped || processed >= MAX_MESSAGES ? undefined : page.nextPageToken;
  } while (pageToken);
  if (error) throw error;
  await updateSyncState({ history_id: maxHistoryId(null, pushHistoryId), last_full_sync_at: new Date().toISOString() });
  return processed;
}

/** Handle one Pub/Sub notification. Throws on failure (the route logs and acks). */
export async function processPush(pushHistoryId: string): Promise<{ processed: number; resynced?: boolean }> {
  const state = await getSyncState();
  if (!state.history_id) {
    await updateSyncState({ history_id: pushHistoryId });
    return { processed: 0 };
  }
  const gmail = gmailRead();
  const seen = new Set<string>();
  let processed = 0;
  let pageToken: string | undefined;
  let latest = state.history_id;
  let error: unknown;
  let capped = false;
  try {
    do {
      const page = await gmail.getHistory(state.history_id, pageToken);
      const ids = page.addedMessageIds.filter((id) => !seen.has(id));
      ids.forEach((id) => seen.add(id));
      const r = await ingestMany(gmail, ids, MAX_MESSAGES - processed);
      processed += r.done;
      error ??= r.error;
      latest = maxHistoryId(latest, page.historyId) ?? latest;
      if (r.capped) capped = true;
      pageToken = capped || error ? undefined : page.nextPageToken;
    } while (pageToken);
  } catch (e) {
    if (isHistoryGone(e)) return { processed: await resyncSince(7, pushHistoryId, gmail), resynced: true };
    throw e;
  }
  if (error) throw error;
  if (capped) throw new Error(`gmail-push: more than ${MAX_MESSAGES} new messages; cursor not advanced, next push resumes`);
  // Advance only once every page is processed: a page's historyId is the mailbox's current id, so
  // storing it after an early page would skip the later pages if this invocation died.
  await updateSyncState({ history_id: maxHistoryId(state.history_id, latest) });
  return { processed };
}
