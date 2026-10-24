-- 2026-10-24: intake no longer opens a new lead for an existing client.
-- On 2026-10-23 an ebook download from Her Promise Circle Foundation's contact opened a second lead
-- ("new", source ebook) next to their won lead, because intake only reused *open* leads.
--
-- New rule (R11): when the contact has no open lead and the signup arrives on an automated channel
-- (website forms, quiz, ebook, Calendly, Stripe, Typeform, inbound email), intake reuses the most
-- recent won lead of the contact, else of the business. It only logs the intake activity on that
-- lead (metadata existing_client=true) and never changes its stage or attribution. Human channels
-- (manual, referral, pro_bono, taproot) still open a new lead, because those mean a real new deal.
-- Lost leads still reopen as a new lead (unchanged).
--
-- Trust (revised the same day after a security review): intake is unauthenticated input, so
-- falling back to the *business's* won lead requires evidence that the person belongs there:
-- the contact was already linked to that business, or the email shares a non-freemail domain
-- with another contact at it. A new address that only names the org gets a new lead as before.
--
-- The result gains `existing_client` (true when a won lead was reused). Supersedes the definition
-- in 2026-10-22_crm_identity_intake.sql; the v_stages array must still match src/lib/crm/stages.ts
-- (enforced by stages.sql-order.test.ts). Idempotent.
begin;

create or replace function crm.intake_lead(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'crm', 'public'
as $function$
declare
  -- Must match src/lib/crm/stages.ts order (enforced by stages.sql-order.test.ts).
  v_stages constant text[] := array['quiz_started','quiz_completed','snapshot_viewed','new','qualification','engaged','call_demo_scheduled','proposal','won','lost'];
  v_channels constant text[] := array['website_contact','website_assessment','manual','referral','pro_bono','quiz','ebook','contact_form','calendly','stripe','typeform','taproot','email_inbound'];
  -- R11: channels that are signups or touches, not a decision to open a new deal.
  v_auto_channels constant text[] := array['website_contact','website_assessment','quiz','ebook','contact_form','calendly','stripe','typeform','email_inbound'];
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
  v_existing_client boolean := false;
  v_business_from_contact boolean := false;
  v_business_trusted boolean;
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
  v_business_from_contact := v_business_id is not null;

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

  -- R11: an automated signup from an existing client lands on their won lead, not a new one.
  -- The business's won lead is used only when the business match is trusted (see header).
  if v_lead_id is null and v_channel = any (v_auto_channels) then
    v_business_trusted := v_business_from_contact
      or (not (v_domain = any (v_freemail)) and exists (
            select 1 from contacts c
            where c.business_id = v_business_id and c.id <> v_contact_id
              and split_part(c.email_norm, '@', 2) = v_domain));
    select id into v_lead_id
    from leads
    where stage = 'won'
      and (contact_id = v_contact_id or (v_business_trusted and business_id = v_business_id))
    order by (contact_id is not distinct from v_contact_id) desc, created_at desc limit 1;
    v_existing_client := v_lead_id is not null;
  end if;

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
  elsif not v_existing_client then
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
                  then jsonb_build_object('stage_ignored', v_stage_ignored) else '{}'::jsonb end
          || case when v_existing_client
                  then jsonb_build_object('existing_client', true) else '{}'::jsonb end);

  return jsonb_build_object(
    'contact_id', v_contact_id,
    'business_id', v_business_id,
    'lead_id', v_lead_id,
    'created_contact', v_created_contact,
    'created_lead', v_created_lead,
    'existing_client', v_existing_client);
end;
$function$;

revoke all on function crm.intake_lead(jsonb) from public, anon, authenticated;
grant execute on function crm.intake_lead(jsonb) to service_role;

commit;
