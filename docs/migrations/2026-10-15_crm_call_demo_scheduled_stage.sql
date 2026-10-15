-- Add "call_demo_scheduled" to the CRM pipeline (between engaged and proposal).
-- NOT YET APPLIED to Supabase project "Rosably" (ukfpmpxwdlpsjqbxreza).
-- crm.leads.stage is text with CHECK leads_stage_check; without this, moving a lead
-- to the new stage fails. Idempotent: safe to re-run.

alter table crm.leads drop constraint if exists leads_stage_check;
alter table crm.leads add constraint leads_stage_check
  check (stage = any (array['quiz_started','quiz_completed','snapshot_viewed','new','qualification','engaged','call_demo_scheduled','proposal','won','lost']));
