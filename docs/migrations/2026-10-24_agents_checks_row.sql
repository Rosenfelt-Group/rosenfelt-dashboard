-- 2026-10-24: the checks service (rosably-agents services/checks) files work items with
-- suggested_by = 'checks'. work_items.suggested_by (and assigned_agent) reference agents(name), so without
-- this row every insert from checks failed with 409 (FK violation) — found on the first live alignment run.
-- active = false: checks is not an agent and is never assigned work. Applied live 2026-10-24 09:05 UTC.
insert into agents (name, display_name, active)
values ('checks', 'Checks service', false)
on conflict (name) do nothing;
