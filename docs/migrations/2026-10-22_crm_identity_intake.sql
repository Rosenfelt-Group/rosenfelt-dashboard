-- Rosably 3.0 phase 1, task 1: identity, attribution, activities, and crm.intake_lead.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent: safe to re-run. Aborts (no changes) if duplicate contact emails exist.
--
-- Access model unchanged: RLS on, no policies; crm.intake_lead is SECURITY DEFINER and
-- executable only by service_role.

begin;

-- 0. Abort clearly if the unique email index cannot be built.
do $$
declare dup text;
begin
  select string_agg(e || ' (' || n || ')', ', ') into dup
  from (
    select lower(btrim(email)) as e, count(*) as n
    from crm.contacts
    where email is not null
    group by 1
    having count(*) > 1
  ) d;
  if dup is not null then
    raise exception 'crm.contacts has duplicate emails (case/whitespace-insensitive); merge them before applying: %', dup;
  end if;
end $$;

-- 1. Contacts: normalised email + uniqueness.
alter table crm.contacts
  add column if not exists email_norm text generated always as (lower(btrim(email))) stored;
create unique index if not exists contacts_email_norm_uidx
  on crm.contacts(email_norm) where email_norm is not null;

-- 2. Lead / business sources.
alter table crm.leads drop constraint if exists leads_source_check;
alter table crm.leads add constraint leads_source_check
  check (source = any (array['website_contact','website_assessment','manual','referral','pro_bono',
    'quiz','ebook','contact_form','calendly','stripe','typeform','taproot','email_inbound']));
alter table crm.businesses drop constraint if exists businesses_source_check;
alter table crm.businesses add constraint businesses_source_check
  check (source = any (array['website_contact','website_assessment','manual','referral','pro_bono',
    'quiz','ebook','contact_form','calendly','stripe','typeform','taproot','email_inbound']));

-- 3. Lead attribution (first touch).
alter table crm.leads
  add column if not exists utm_source    text,
  add column if not exists utm_medium    text,
  add column if not exists utm_campaign  text,
  add column if not exists utm_content   text,
  add column if not exists utm_term      text,
  add column if not exists referrer      text,
  add column if not exists landing_path  text,
  add column if not exists first_touch_at timestamptz;

-- 4. Activities: attachable to contact / client / engagement, not only a lead.
alter table crm.lead_activities
  add column if not exists contact_id    uuid references crm.contacts(id)     on delete set null,
  add column if not exists client_id     uuid references crm.clients(id)      on delete set null,
  add column if not exists engagement_id uuid references rooms.engagements(id) on delete set null;
alter table crm.lead_activities alter column lead_id drop not null;

alter table crm.lead_activities drop constraint if exists lead_activities_has_subject;
alter table crm.lead_activities add constraint lead_activities_has_subject
  check (lead_id is not null or contact_id is not null or client_id is not null);

alter table crm.lead_activities drop constraint if exists lead_activities_activity_type_check;
alter table crm.lead_activities add constraint lead_activities_activity_type_check
  check (activity_type = any (array['note','email_sent','email_received','stage_change','assessment','system','intake']));
alter table crm.lead_activities drop constraint if exists lead_activities_logged_by_check;
alter table crm.lead_activities add constraint lead_activities_logged_by_check
  check (logged_by = any (array['brian','jordan','riley','avery','casey','sam','system','pickle']));

create index if not exists activities_contact_idx on crm.lead_activities(contact_id, created_at desc) where contact_id is not null;
create index if not exists activities_client_idx  on crm.lead_activities(client_id, created_at desc)  where client_id is not null;
create index if not exists activities_engagement_idx on crm.lead_activities(engagement_id) where engagement_id is not null;

-- 5. crm.intake_lead: the single entry point every lead channel uses.
create or replace function crm.intake_lead(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = crm, public
as $fn$
declare
  -- Must match src/lib/crm/stages.ts order (enforced by stages.sql-order.test.ts).
  v_stages constant text[] := array['quiz_started','quiz_completed','snapshot_viewed','new','qualification','engaged','call_demo_scheduled','proposal','won','lost'];
  v_channels constant text[] := array['website_contact','website_assessment','manual','referral','pro_bono','quiz','ebook','contact_form','calendly','stripe','typeform','taproot','email_inbound'];
  v_freemail constant text[] := array['gmail.com','outlook.com','yahoo.com','icloud.com','hotmail.com'];

  v_channel text := nullif(btrim(p->>'channel'), '');
  v_email   text := nullif(btrim(p->>'email'), '');
  v_name    text := nullif(btrim(p->>'name'), '');
  v_org     text := nullif(btrim(p->>'org'), '');
  v_phone   text := nullif(btrim(p->>'phone'), '');
  v_stage   text := coalesce(nullif(btrim(p->>'stage'), ''), 'new');
  v_entry   text;
  v_value   numeric(10,2) := nullif(btrim(p->>'estimated_value'), '')::numeric;
  v_domain  text;
  v_bname   text;
  v_first   text;
  v_last    text;

  v_contact_id uuid;
  v_business_id uuid;
  v_lead_id uuid;
  v_created_contact boolean := false;
  v_created_lead boolean := false;
  v_cur_stage text;
  v_stage_ignored text;
  v_freemail_noorg boolean;
begin
  if v_channel is null or not (v_channel = any (v_channels)) then
    raise exception 'intake_lead: unknown or missing channel: %', coalesce(v_channel, '(null)');
  end if;
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'intake_lead: a valid email is required';
  end if;
  if not (v_stage = any (v_stages)) then
    raise exception 'intake_lead: unknown stage: %', v_stage;
  end if;
  -- R9: intake never closes a lead. 'lost' is ignored: new leads get the default
  -- stage, existing leads keep their stage.
  if v_stage = 'lost' then
    v_stage_ignored := 'lost';
    v_stage := 'new';
  end if;
  v_entry := coalesce(nullif(btrim(p->>'entry_stage'), ''),
                      case when v_stage = 'quiz_started' then 'quiz_started' else 'new' end);
  if v_entry not in ('quiz_started','new') then
    raise exception 'intake_lead: unknown entry_stage: %', v_entry;
  end if;

  v_domain := lower(split_part(v_email, '@', 2));

  -- Contact
  select id, business_id into v_contact_id, v_business_id
  from contacts where email_norm = lower(v_email);

  if v_contact_id is null then
    v_first := coalesce(split_part(v_name, ' ', 1), split_part(v_email, '@', 1));
    v_last  := nullif(btrim(substr(v_name, length(split_part(v_name, ' ', 1)) + 1)), '');
    if v_first is null or v_first = '' then v_first := split_part(v_email, '@', 1); end if;
  end if;

  -- Business: contact's own, else match by org name, else create.
  if v_business_id is null then
    v_freemail_noorg := (v_org is null and v_domain = any (v_freemail));
    if v_org is not null then
      v_bname := v_org;
    elsif v_domain = any (v_freemail) then
      v_bname := coalesce(v_name, split_part(v_email, '@', 1));
    else
      v_bname := v_domain;
    end if;

    -- R10: free-mail with no org always gets a new business (never name-matched).
    if not v_freemail_noorg then
      select id into v_business_id from businesses
      where lower(name) = lower(v_bname) order by created_at limit 1;
    end if;

    if v_business_id is null then
      insert into businesses (name, source, email, phone)
      values (v_bname, v_channel, v_email, v_phone)
      returning id into v_business_id;
    end if;
  end if;

  if v_contact_id is null then
    insert into contacts (business_id, first_name, last_name, email, phone)
    values (v_business_id, v_first, v_last, v_email, v_phone)
    on conflict (email_norm) where email_norm is not null do nothing
    returning id into v_contact_id;
    if v_contact_id is null then
      -- lost a race with a concurrent intake: reuse the winner
      select id into v_contact_id from contacts where email_norm = lower(v_email);
    else
      v_created_contact := true;
    end if;
  else
    update contacts
       set business_id = coalesce(business_id, v_business_id),
           phone = coalesce(phone, v_phone)
     where id = v_contact_id;
  end if;

  -- Lead: most recent open lead of this contact, else new.
  select id, stage into v_lead_id, v_cur_stage
  from leads
  where contact_id = v_contact_id and stage not in ('won','lost')
  order by created_at desc limit 1
  for update;

  if v_lead_id is null then
    insert into leads (business_id, contact_id, stage, entry_stage, source, estimated_value,
                       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                       referrer, landing_path, first_touch_at)
    values (v_business_id, v_contact_id, v_stage, v_entry, v_channel, v_value,
            nullif(p->>'utm_source',''), nullif(p->>'utm_medium',''), nullif(p->>'utm_campaign',''),
            nullif(p->>'utm_content',''), nullif(p->>'utm_term',''),
            nullif(p->>'referrer',''), nullif(p->>'landing_path',''), now())
    returning id into v_lead_id;
    v_created_lead := true;
  else
    update leads set
      stage = case when v_stage_ignored is null
                    and array_position(v_stages, v_stage) > array_position(v_stages, stage)
                   then v_stage else stage end,
      estimated_value = coalesce(estimated_value, v_value),
      utm_source   = coalesce(utm_source,   nullif(p->>'utm_source','')),
      utm_medium   = coalesce(utm_medium,   nullif(p->>'utm_medium','')),
      utm_campaign = coalesce(utm_campaign, nullif(p->>'utm_campaign','')),
      utm_content  = coalesce(utm_content,  nullif(p->>'utm_content','')),
      utm_term     = coalesce(utm_term,     nullif(p->>'utm_term','')),
      referrer     = coalesce(referrer,     nullif(p->>'referrer','')),
      landing_path = coalesce(landing_path, nullif(p->>'landing_path','')),
      first_touch_at = coalesce(first_touch_at, now())
    where id = v_lead_id;
  end if;

  insert into lead_activities (lead_id, contact_id, activity_type, content, logged_by, metadata)
  values (v_lead_id, v_contact_id, 'intake', nullif(p->>'summary',''), 'system',
          jsonb_build_object('channel', v_channel, 'payload', p->'payload')
          || case when v_stage_ignored is not null
                  then jsonb_build_object('stage_ignored', v_stage_ignored) else '{}'::jsonb end);

  return jsonb_build_object(
    'contact_id', v_contact_id,
    'business_id', v_business_id,
    'lead_id', v_lead_id,
    'created_contact', v_created_contact,
    'created_lead', v_created_lead);
end;
$fn$;

revoke all on function crm.intake_lead(jsonb) from public, anon, authenticated;
grant execute on function crm.intake_lead(jsonb) to service_role;

commit;
