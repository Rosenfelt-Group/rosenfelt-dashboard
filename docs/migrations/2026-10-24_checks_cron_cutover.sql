-- 2026-10-24: the scheduled checks move from Casey to the checks service (rosably-agents services/checks).
-- Casey design-only plan, Task 7. Run in ONE transaction, in the same window as deploying the Casey build
-- whose scheduler registers no jobs (rosably-agents feat/checks-cutover): Casey's old scheduler ignored
-- disabled rows (it fell back to hard-coded defaults), so disabling these rows alone would not stop it.
--
-- Cron values are Casey's live values on 2026-10-24 (memory_maintenance was daily 06:00, not */10).
-- alignment_audit becomes quarterly (§4). weekly_audit (the LLM audit) is retired and not copied.
-- No open audit_alerts with source='casey-audit' existed on 2026-10-24, so none are resolved here.
begin;

update agent_cron_config
   set enabled = false, updated_by = 'checks-cutover', updated_at = now()
 where agent = 'casey';

insert into agent_cron_config (agent, job_id, cron, enabled, min_interval_seconds, updated_by, updated_at) values
  ('checks', 'weekly_regression_run',      '0 8 * * sun',      true, 300, 'checks-cutover', now()),
  ('checks', 'daily_indexer_health_check', '0 6 * * *',        true, 300, 'checks-cutover', now()),
  ('checks', 'memory_maintenance',         '0 6 * * *',        true, 300, 'checks-cutover', now()),
  ('checks', 'patch_detection',            '0 7 * * mon',      true, 300, 'checks-cutover', now()),
  ('checks', 'weekly_gsc_sync',            '0 6 * * tue',      true, 300, 'checks-cutover', now()),
  ('checks', 'alignment_audit',            '0 7 1 1,4,7,10 *', true, 300, 'checks-cutover', now());

commit;

-- Then: POST /scheduler/reschedule on checks (applies the rows) and confirm both /scheduler/jobs:
-- Casey lists no jobs; checks lists the 6 jobs, each with a next_run_time.
--
-- Rollback: update agent_cron_config set enabled = false where agent = 'checks';  (then reschedule checks)
-- and redeploy Casey's previous image (tag :pre-checks-cutover-2026-10-24); re-enable the casey rows.
