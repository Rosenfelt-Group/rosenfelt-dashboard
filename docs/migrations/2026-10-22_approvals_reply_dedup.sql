-- Rosably 3.0 phase 1, task 13b (R73): one reply draft per inbound email.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent: safe to re-run. One transaction.
--
-- Riley (POST /email/draft-reply) stores payload->>'reply_to_email_message_id' on every reply approval;
-- this partial unique index is the race guard behind its SELECT pre-check. It covers email_send rows
-- that carry the key only, so every other approval is unaffected. A pre-flight check refuses to create
-- the index when duplicates already exist, so applying never fails halfway on a unique violation.

begin;

do $$
declare
  dups int;
begin
  select count(*) into dups from (
    select payload->>'reply_to_email_message_id'
      from public.pending_approvals
     where action_type = 'email_send' and payload ? 'reply_to_email_message_id'
     group by 1 having count(*) > 1
  ) d;
  if dups > 0 then
    raise exception 'approvals_reply_dedup: % reply_to_email_message_id value(s) already have more than one email_send approval; resolve them before creating the unique index', dups;
  end if;
end $$;

create unique index if not exists pending_approvals_reply_to_email_uidx
  on public.pending_approvals ((payload->>'reply_to_email_message_id'))
  where action_type = 'email_send' and payload ? 'reply_to_email_message_id';

commit;
