-- Rosably 3.0 phase 1, task 7: atomic, monotonic Gmail history cursor.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent. Requires 2026-10-22_crm_email.sql (crm.gmail_sync_state).

begin;

create or replace function crm.advance_gmail_cursor(p_history_id text, p_mark_full_sync boolean default false)
returns text
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $$
declare
  v text;
begin
  if p_history_id is null or p_history_id !~ '^[0-9]+$' then
    raise exception 'invalid history id: %', p_history_id;
  end if;
  update crm.gmail_sync_state
     set history_id = greatest(coalesce(history_id, '0')::numeric, p_history_id::numeric)::text,
         last_full_sync_at = case when p_mark_full_sync then now() else last_full_sync_at end
   where id
  returning history_id into v;
  return v;
end;
$$;

revoke all on function crm.advance_gmail_cursor(text, boolean) from public, anon, authenticated;
grant execute on function crm.advance_gmail_cursor(text, boolean) to service_role;

commit;
