-- 2026-10-17_remove_anon_access.sql
-- Work item #1313. Apply only after the dashboard release that stops using the
-- anon key (browser polling via /api routes; agent-prompts, agent-memory and
-- agent-history routes on supabaseAdmin) is live in production.
--
-- The anon (publishable) key ships in the dashboard's browser bundle, so any
-- policy granted to anon is public. Supabase Auth sign-ups were also open, so
-- policies granted to authenticated were effectively public too. Every
-- legitimate reader and writer (dashboard API routes, agents, WordPress, n8n)
-- uses a secret key and bypasses RLS.
-- Applied via: psql service=rosably (Claude Code)

BEGIN;

-- anon policies
DROP POLICY IF EXISTS "anon_select"                           ON public.agent_config;
DROP POLICY IF EXISTS "anon can delete agent_memory"          ON public.agent_memory;
DROP POLICY IF EXISTS "anon can insert agent_memory"          ON public.agent_memory;
DROP POLICY IF EXISTS "anon can select agent_memory"          ON public.agent_memory;
DROP POLICY IF EXISTS "anon can update agent_memory"          ON public.agent_memory;
DROP POLICY IF EXISTS "anon can insert agent_prompt_versions" ON public.agent_prompt_versions;
DROP POLICY IF EXISTS "anon can read agent_prompt_versions"   ON public.agent_prompt_versions;
DROP POLICY IF EXISTS "anon can insert agent_prompts"         ON public.agent_prompts;
DROP POLICY IF EXISTS "anon can read agent_prompts"           ON public.agent_prompts;
DROP POLICY IF EXISTS "anon can update agent_prompts"         ON public.agent_prompts;
DROP POLICY IF EXISTS "anon_insert_assessment_leads"          ON public.assessment_leads;
DROP POLICY IF EXISTS "anon_read_audit_log"                   ON public.audit_log;
DROP POLICY IF EXISTS "anon_select"                           ON public.patch_remediations;
DROP POLICY IF EXISTS "anon_select"                           ON public.patch_runs;
DROP POLICY IF EXISTS "anon_select"                           ON public.pending_approvals;
DROP POLICY IF EXISTS "anon_select"                           ON public.regression_runs;
DROP POLICY IF EXISTS "anon can insert workflow_logs"         ON public.workflow_logs;
DROP POLICY IF EXISTS "anon can select workflow_logs"         ON public.workflow_logs;
DROP POLICY IF EXISTS "anon_select"                           ON public.workflow_logs;

-- authenticated policies (no Supabase Auth users exist; the dashboard has its own login)
DROP POLICY IF EXISTS "authenticated_read_audit_log"           ON public.audit_log;
DROP POLICY IF EXISTS "authenticated_insert_audit_log"         ON public.audit_log;
DROP POLICY IF EXISTS "authenticated_update_audit_log"         ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated users can read"           ON public.doc_registry;
DROP POLICY IF EXISTS "authenticated can select workflow_logs" ON public.workflow_logs;

-- tables that had RLS off entirely; all writers use the service role
ALTER TABLE public.token_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_run_log ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Also done outside SQL: Supabase Auth email sign-ups disabled
-- (Management API PATCH /v1/projects/{ref}/config/auth {"disable_signup": true}).
