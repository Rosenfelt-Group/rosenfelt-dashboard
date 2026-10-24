// Test helper: in-memory stand-in for supabaseAdmin covering crm.gmail_sync_state, public.workflow_logs
// and crm.purge_trash.
function makeFakeDb() {
  const state = {
    row: { history_id: null as string | null, watch_expiration: null as string | null, last_full_sync_at: null as string | null },
    logs: [] as Record<string, unknown>[],
    purgeCalls: [] as unknown[],
  };
  const supabaseAdmin = {
    schema: (_s: string) => ({
      rpc: async (fn: string, a: { p_history_id: string; p_mark_full_sync?: boolean }) => {
        if (fn === "purge_trash") { state.purgeCalls.push(a); return { data: { purged: 2, skipped: [] }, error: null }; }
        if (fn !== "advance_gmail_cursor") return { data: null, error: { message: `unexpected rpc ${fn}` } };
        const cur = state.row.history_id;
        state.row.history_id = !cur || BigInt(a.p_history_id) > BigInt(cur) ? a.p_history_id : cur;
        if (a.p_mark_full_sync) state.row.last_full_sync_at = new Date().toISOString();
        return { data: state.row.history_id, error: null };
      },
      from: (_t: string) => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { ...state.row }, error: null }) }) }),
        update: (patch: Partial<typeof state.row>) => ({ eq: async () => { Object.assign(state.row, patch); return { error: null }; } }),
      }),
    }),
    from: (_t: string) => ({ insert: async (r: Record<string, unknown>) => { state.logs.push(r); return { error: null }; } }),
  };
  return { state, supabaseAdmin };
}

export const fakeDb = makeFakeDb();
