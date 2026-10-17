-- 2026-10-17_revoke_run_sql_public.sql
-- Work item #1313 follow-up. public.run_sql(text) is SECURITY DEFINER (owner
-- postgres) and executes arbitrary SQL. EXECUTE was granted to anon and
-- authenticated, so the publishable key in the dashboard's browser bundle
-- could run any SQL as postgres via POST /rest/v1/rpc/run_sql.
-- The only caller is the dashboard's /api/supabase/query route, which uses
-- the service role.
-- Applied via: psql service=rosably (Claude Code)
REVOKE EXECUTE ON FUNCTION public.run_sql(text) FROM PUBLIC, anon, authenticated;
