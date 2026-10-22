-- Rosably 3.0 phase 1, task 8 (R30): execution result columns on public.pending_approvals.
-- NOT YET APPLIED. Apply by hand with the owner's approval. Idempotent.
-- The executor writes them: executed_at/result on success, error on failure.
-- executing_since is set when the executor claims the row. The stale sweep uses it (not reviewed_at,
-- which is set at approval time and can be hours before a retry of the execute call); a row 'executing'
-- for more than 10 minutes is marked failed with error 'stale executing'.
begin;
alter table public.pending_approvals add column if not exists executed_at timestamptz;
alter table public.pending_approvals add column if not exists result jsonb;
alter table public.pending_approvals add column if not exists error text;
alter table public.pending_approvals add column if not exists executing_since timestamptz;
commit;
