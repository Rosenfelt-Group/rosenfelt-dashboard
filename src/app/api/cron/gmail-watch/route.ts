import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { gmailRead } from "@/lib/email/gmail-user";
import { sweepStaleExecuting } from "@/lib/email/executor";
import { getSyncState, updateSyncState, advanceCursor, logWorkflow } from "@/lib/email/gmail-sync";

const RENEW_WITHIN_MS = 48 * 3600_000;

function secretMatches(header: string, secret: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(header), h(`Bearer ${secret}`));
}

type JobResult = { name: string; ok: boolean; [k: string]: unknown };

async function gmailWatchJob(): Promise<JobResult> {
  const state = await getSyncState();
  const exp = state.watch_expiration ? new Date(state.watch_expiration).getTime() : null;
  if (exp !== null && exp - Date.now() >= RENEW_WITHIN_MS) {
    return { name: "gmail-watch", ok: true, renewed: false, expiration: state.watch_expiration };
  }
  const topic = process.env.GMAIL_WATCH_TOPIC;
  if (!topic) throw new Error("GMAIL_WATCH_TOPIC is not set");
  const w = await gmailRead().watch(topic);
  const expiration = new Date(Number(w.expiration)).toISOString();
  await updateSyncState({ watch_expiration: expiration });
  if (!state.history_id) await advanceCursor(w.historyId); // seed only; atomic and never regresses
  return { name: "gmail-watch", ok: true, renewed: true, expiration };
}

// Marks approvals stuck in 'executing' for more than 10 minutes as failed ('stale executing').
async function staleApprovalSweepJob(): Promise<JobResult> {
  return { name: "stale-approval-sweep", ok: true, swept: await sweepStaleExecuting() };
}

const JOBS: { name: string; run: () => Promise<JobResult> }[] = [
  { name: "gmail-watch", run: gmailWatchJob },
  { name: "stale-approval-sweep", run: staleApprovalSweepJob },
];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(request.headers.get("authorization") ?? "", secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const jobs: JobResult[] = [];
  for (const job of JOBS) {
    try {
      jobs.push(await job.run());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logWorkflow(job.name, "error", msg, "cron");
      jobs.push({ name: job.name, ok: false, error: msg });
    }
  }
  return NextResponse.json({ ok: jobs.every((j) => j.ok), jobs });
}
