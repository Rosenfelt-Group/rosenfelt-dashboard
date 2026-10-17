-- A third seed template: no questions, one empty section. Start a discovery from it
-- and add questions from the bank or write your own in the draft editor. Sending is
-- refused until at least one question is added (SnapshotSchema in snapshot.ts).
-- Idempotent: safe to re-run.

insert into crm.discovery_templates (id, name, description, intro_text, estimated_minutes, sections, is_default) values
  ('2e0bb0bb-1925-4102-9587-3dca5c891c5d', 'Blank: custom questions',
   'Starts empty. Add questions from the bank or write your own for this prospect.',
   'A few questions so our call can focus on what matters most to you. It saves as you go, so you can stop and come back with the same link.',
   5, $j$[{"id":"questions","title":"Questions"}]$j$::jsonb, false)
on conflict (name) do nothing;
