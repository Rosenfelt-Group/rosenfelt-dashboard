// Test helper: in-memory stand-in for supabaseAdmin covering crm.gmail_sync_state and public.workflow_logs.
function makeFakeDb() {
  const state = { row: { history_id: null as string | null, watch_expiration: null as string | null, last_full_sync_at: null as string | null }, logs: [] as Record<string, unknown>[] };
  const supabaseAdmin = {
    schema: (_s: string) => ({
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
