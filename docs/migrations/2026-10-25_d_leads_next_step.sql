-- 2026-10-25 (CRM refresh, stream T): next step and days-in-stage for the pipeline and Today.
--
-- 1. crm.leads.next_step (text) + next_step_due (date): every open deal has one next action and a
--    due date. Today lists the ones due or overdue; the deal drawer edits them.
-- 2. crm.leads.stage_entered_at (timestamptz, not null): when the lead entered its current stage.
--    Kept by a BEFORE trigger (set on insert, reset when the stage changes), so the pipeline no
--    longer shows "days since any edit" (updated_at) as days in stage.
--    Backfill: the latest stage_change activity whose metadata.to equals the current stage
--    (crm.log_stage_change writes those), else the lead's created_at. The derivation is
--    crm.derive_stage_entered_at() so db-tests can check it.
-- Additive and idempotent: re-running only fills rows that are still null.
begin;

alter table crm.leads
  add column if not exists next_step text,
  add column if not exists next_step_due date,
  add column if not exists stage_entered_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_next_step_len'
                   and conrelid = 'crm.leads'::regclass) then
    alter table crm.leads add constraint leads_next_step_len check (char_length(next_step) <= 500);
  end if;
end $$;

create or replace function crm.derive_stage_entered_at(p_lead uuid)
 returns timestamptz
 language sql
 stable
 set search_path = crm, public, pg_temp
as $$
  select coalesce(
    (select max(a.created_at) from crm.lead_activities a
      where a.lead_id = l.id and a.activity_type = 'stage_change' and a.metadata->>'to' = l.stage),
    l.created_at)
  from crm.leads l where l.id = p_lead
$$;
revoke all on function crm.derive_stage_entered_at(uuid) from public, anon, authenticated;
grant execute on function crm.derive_stage_entered_at(uuid) to service_role;

update crm.leads set stage_entered_at = crm.derive_stage_entered_at(id) where stage_entered_at is null;

alter table crm.leads alter column stage_entered_at set default now();
alter table crm.leads alter column stage_entered_at set not null;

create or replace function crm.leads_track_stage_entered()
 returns trigger
 language plpgsql
 set search_path = crm, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif new.stage is distinct from old.stage then
    new.stage_entered_at := now();
  end if;
  return new;
end $$;
revoke all on function crm.leads_track_stage_entered() from public, anon, authenticated;

create or replace trigger leads_track_stage_entered
  before insert or update of stage on crm.leads
  for each row execute function crm.leads_track_stage_entered();

create index if not exists leads_next_step_due_idx on crm.leads (next_step_due) where next_step is not null;

commit;
